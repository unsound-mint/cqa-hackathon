import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Resolves a conversation's `audioUrl` to something an <audio> element can play.
 *
 * The organizer's export links each call to an HTML player page (title "Воспроизведение записи") whose <source> points
 * at the actual mp3 on another host; a browser cannot play the page itself. The stored `audioUrl` stays untouched (it is
 * original data); the media link is resolved per request and kept only in a short in-memory cache, never stored,
 * because it carries a signature that may expire. A link that already serves audio is used as it is.
 */
export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { url: string; at: number }>();

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** The first <source src> (or <audio src>) of a player page, as an absolute http(s) URL; null if there is none. */
export function mediaSourceIn(html: string, pageUrl: string): string | null {
  const m = /<source\b[^>]*\bsrc\s*=\s*"([^"]+)"/i.exec(html) ?? /<audio\b[^>]*\bsrc\s*=\s*"([^"]+)"/i.exec(html);
  if (!m) return null;
  try {
    const url = new URL(decode(m[1]!), pageUrl);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export class AudioError extends Error {}

export async function resolveAudio(audioUrl: string, fetchFn: FetchLike = fetch as unknown as FetchLike, now = Date.now()): Promise<string> {
  const hit = cache.get(audioUrl);
  if (hit && now - hit.at < TTL_MS) return hit.url;
  let res;
  try {
    res = await fetchFn(audioUrl, { signal: AbortSignal.timeout(10_000), headers: { range: 'bytes=0-0' } });
  } catch {
    throw new AudioError('recording host did not answer');
  }
  if (!res.ok) throw new AudioError(`recording host answered ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  let url: string | null = audioUrl;
  if (!/^(audio|video)\//i.test(type)) {
    url = mediaSourceIn(await res.text(), audioUrl);
    if (!url) throw new AudioError('recording page has no audio source');
  }
  cache.set(audioUrl, { url, at: now });
  return url;
}

/** Tests only. */
export const clearAudioCache = () => cache.clear();

/**
 * Local copies of call recordings, so playback does not depend on the organizer's signed links (which may expire) or
 * their host being up during a demo. Files live next to the database in data/private/audio/ (git-ignored: real calls
 * never enter the repository). The stored `audioUrl` is unchanged; a copy is made after an import (prefetch) or on the
 * first play (in the background, while that play is redirected to the original file).
 */
export type AudioStore = { dir: string; fetchFn?: FetchLike };

const MAX_BYTES = 300 * 1024 * 1024;
const inflight = new Map<string, Promise<void>>();

/** File name for a conversation id: readable when safe, hashed otherwise, never a path. */
const baseName = (id: string) => (/^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : createHash('sha256').update(id).digest('hex').slice(0, 32));
const files = (store: AudioStore, id: string) => ({ data: join(store.dir, `${baseName(id)}.audio`), type: join(store.dir, `${baseName(id)}.type`) });

export function hasLocalAudio(store: AudioStore, id: string): boolean {
  const f = files(store, id);
  return existsSync(f.data) && existsSync(f.type);
}

/** Downloads one recording into the store (once; concurrent calls share the download). */
export function downloadAudio(store: AudioStore, id: string, audioUrl: string): Promise<void> {
  const running = inflight.get(id);
  if (running) return running;
  const job = (async () => {
    if (hasLocalAudio(store, id)) return;
    const fetchFn = store.fetchFn ?? (fetch as unknown as FetchLike);
    const media = await resolveAudio(audioUrl, fetchFn);
    const res = await fetchFn(media, { signal: AbortSignal.timeout(120_000) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !/^(audio|video)\//i.test(type)) throw new AudioError(`recording download failed (${res.status} ${type || 'no type'})`);
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new AudioError('recording is too large to store');
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_BYTES) throw new AudioError('recording is too large to store');
    mkdirSync(store.dir, { recursive: true });
    const f = files(store, id);
    // Write then rename: a crash mid-download never leaves a truncated file that looks complete.
    writeFileSync(`${f.data}.part`, body);
    renameSync(`${f.data}.part`, f.data);
    writeFileSync(f.type, type.split(';')[0]!.trim());
  })().finally(() => inflight.delete(id));
  inflight.set(id, job);
  return job;
}

/** Fetches the recordings of these conversations in the background, two at a time; failures are logged, not thrown. */
export async function prefetchAudio(store: AudioStore, items: { id: string; audioUrl: string | null }[], log?: (msg: string) => void): Promise<number> {
  const todo = items.filter((x): x is { id: string; audioUrl: string } => !!x.audioUrl && !hasLocalAudio(store, x.id));
  let done = 0;
  const worker = async () => {
    for (let x = todo.shift(); x; x = todo.shift()) {
      try {
        await downloadAudio(store, x.id, x.audioUrl);
        done++;
      } catch (e) {
        log?.(`recording ${x.id} not stored: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return done;
}

/** Serves a stored recording with HTTP range support (the <audio> element seeks with ranges). */
export function sendLocalAudio(store: AudioStore, id: string, req: FastifyRequest, reply: FastifyReply) {
  const f = files(store, id);
  const size = statSync(f.data).size;
  const type = readFileSync(f.type, 'utf8') || 'audio/mpeg';
  reply.header('accept-ranges', 'bytes').header('content-type', type).header('cache-control', 'private, max-age=3600');
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (!m || (m[1] === '' && m[2] === '')) return reply.header('content-length', size).send(createReadStream(f.data));
  let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
  let end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  start = Math.max(0, start);
  if (start > end || start >= size) return reply.code(416).header('content-range', `bytes */${size}`).send();
  end = Math.min(end, size - 1);
  return reply.code(206).header('content-range', `bytes ${start}-${end}/${size}`).header('content-length', end - start + 1).send(createReadStream(f.data, { start, end }));
}
