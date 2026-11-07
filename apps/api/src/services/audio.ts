/**
 * Resolves a conversation's `audioUrl` to something an <audio> element can play.
 *
 * The organizer's export links each call to an HTML player page (title "Воспроизведение записи") whose <source> points
 * at the actual mp3 on another host; a browser cannot play the page itself. The stored `audioUrl` stays untouched (it is
 * original data); the media link is resolved per request and kept only in a short in-memory cache, never stored,
 * because it carries a signature that may expire. A link that already serves audio is used as it is.
 */
export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

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
