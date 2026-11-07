import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db/index.js';
import { conversations } from '../src/db/schema.js';
import { clearAudioCache, downloadAudio, mediaSourceIn, prefetchAudio, type FetchLike } from '../src/services/audio.js';

/** Fictional hosts only. The page mirrors the organizer's player page: an <audio> with one <source> to the mp3. */
const PAGE = 'https://player.example.invalid/rec/1?sig=abc';
const MP3 = 'https://media.example.invalid/files/1.mp3?a=1&b=2';
const html = `<html><title>Воспроизведение записи</title><audio id="myAudio" controls><source src="${MP3.replace('&', '&amp;')}" type="audio/mpeg"></audio></html>`;
const BYTES = '0123456789';

type Reply = { type: string; body?: string; status?: number };
/** A fake network: each URL answers as configured; unknown URLs fail like a dead host. */
const net = (routes: Record<string, Reply>): FetchLike => async (url) => {
  const r = routes[url];
  if (!r) throw new Error('host down');
  const body = r.body ?? '';
  return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, headers: { get: (n: string) => (n === 'content-type' ? r.type : n === 'content-length' ? String(body.length) : null) }, text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer };
};
const organizer = net({ [PAGE]: { type: 'text/html; charset=utf-8', body: html }, [MP3]: { type: 'audio/mpeg', body: BYTES } });

function setup(fetchFn: FetchLike, audioUrl: string | null = PAGE, prefetchOnStart = false) {
  const db = openDb(':memory:');
  db.insert(conversations).values({ id: 'call-1', datasetGroupId: 'g', language: 'RU', channel: 'voice call', audioUrl, transcript: [{ index: 0, timestamp: '00:00', speaker: 'client', text: 'a' }], importedAt: '2026-11-07T00:00:00Z' }).run();
  const audioDir = mkdtempSync(join(tmpdir(), 'cqa-audio-'));
  return { app: buildApp({ db, audioFetch: fetchFn, audioDir, webDist: null, prefetchOnStart }), audioDir };
}

describe('call recordings', () => {
  beforeEach(() => clearAudioCache());

  it('first play redirects to the media behind the organizer page and stores a copy; later plays come from disk with ranges', async () => {
    const { app, audioDir } = setup(organizer);
    const first = await app.inject({ url: '/api/conversations/call-1/audio' });
    expect(first.statusCode).toBe(302);
    expect(first.headers.location).toBe(MP3); // entities decoded
    await downloadAudio({ dir: audioDir, fetchFn: organizer }, 'call-1', PAGE); // joins the background download
    const whole = await app.inject({ url: '/api/conversations/call-1/audio' });
    expect(whole.statusCode).toBe(200);
    expect(whole.headers['content-type']).toBe('audio/mpeg');
    expect(whole.body).toBe(BYTES);
    const part = await app.inject({ url: '/api/conversations/call-1/audio', headers: { range: 'bytes=2-5' } });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe('bytes 2-5/10');
    expect(part.body).toBe('2345');
    expect((await app.inject({ url: '/api/conversations/call-1/audio', headers: { range: 'bytes=-3' } })).body).toBe('789');
    expect((await app.inject({ url: '/api/conversations/call-1/audio', headers: { range: 'bytes=20-' } })).statusCode).toBe(416);
  });

  it('a link that already serves audio is used as it is', async () => {
    const { app } = setup(net({ [PAGE]: { type: 'audio/mpeg', body: BYTES } }));
    expect((await app.inject({ url: '/api/conversations/call-1/audio' })).headers.location).toBe(PAGE);
  });

  it('answers 502 when the page has no audio or the host fails, and 404 without a recording', async () => {
    expect((await setup(net({ [PAGE]: { type: 'text/html', body: '<p>expired</p>' } })).app.inject({ url: '/api/conversations/call-1/audio' })).statusCode).toBe(502);
    expect((await setup(net({ [PAGE]: { type: 'text/html', status: 403 } })).app.inject({ url: '/api/conversations/call-1/audio' })).statusCode).toBe(502);
    expect((await setup(organizer, null).app.inject({ url: '/api/conversations/call-1/audio' })).statusCode).toBe(404);
    expect((await setup(organizer).app.inject({ url: '/api/conversations/none/audio' })).statusCode).toBe(404);
  });

  it('prefetch stores what it can, skips chats, and leaves nothing behind for a failed download', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cqa-audio-'));
    const log: string[] = [];
    const n = await prefetchAudio({ dir, fetchFn: organizer }, [{ id: 'call-1', audioUrl: PAGE }, { id: 'chat-1', audioUrl: null }, { id: 'call-2', audioUrl: 'https://down.example.invalid/x' }], (m) => log.push(m));
    expect(n).toBe(1);
    expect(readdirSync(dir).sort()).toEqual(['call-1.audio', 'call-1.type']);
    expect(log).toEqual([expect.stringContaining('call-2')]);
  });

  it('on start, copies recordings missing from disk (a database imported before copies were kept, or a failed copy)', async () => {
    const { app, audioDir } = setup(organizer, PAGE, true);
    expect(readdirSync(audioDir)).toEqual([]);
    await app.ready();
    await vi.waitFor(() => expect(readdirSync(audioDir).sort()).toEqual(['call-1.audio', 'call-1.type']));
    const res = await app.inject({ url: '/api/conversations/call-1/audio' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(BYTES);
  });

  it('ignores non-http sources', () => {
    expect(mediaSourceIn('<source src="javascript:alert(1)">', PAGE)).toBeNull();
    expect(mediaSourceIn('<source src="/rel/2.mp3">', PAGE)).toBe('https://player.example.invalid/rel/2.mp3');
  });
});
