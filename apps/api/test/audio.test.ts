import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db/index.js';
import { conversations } from '../src/db/schema.js';
import { clearAudioCache, mediaSourceIn, type FetchLike } from '../src/services/audio.js';

/** Fictional hosts only. The page mirrors the organizer's player page: an <audio> with one <source> to the mp3. */
const PAGE = 'https://player.example.invalid/rec/1?sig=abc';
const MP3 = 'https://media.example.invalid/files/1.mp3?a=1&b=2';
const html = `<html><title>Воспроизведение записи</title><audio id="myAudio" controls><source src="${MP3.replace('&', '&amp;')}" type="audio/mpeg"></audio></html>`;

function setup(fetchFn: FetchLike, audioUrl: string | null = PAGE) {
  const db = openDb(':memory:');
  db.insert(conversations).values({ id: 'call-1', datasetGroupId: 'g', language: 'RU', channel: 'voice call', audioUrl, transcript: [{ index: 0, timestamp: '00:00', speaker: 'client', text: 'a' }], importedAt: '2026-11-07T00:00:00Z' }).run();
  return buildApp({ db, audioFetch: fetchFn, webDist: null });
}
const respond = (type: string, body = '', status = 200): FetchLike => async () => ({ ok: status < 400, status, headers: { get: (n: string) => (n === 'content-type' ? type : null) }, text: async () => body });

describe('call recordings', () => {
  beforeEach(() => clearAudioCache());

  it('redirects to the media file behind the organizer player page, decoding entities', async () => {
    const res = await setup(respond('text/html; charset=utf-8', html)).inject({ url: '/api/conversations/call-1/audio' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(MP3);
  });

  it('uses a link that already serves audio as it is', async () => {
    const res = await setup(respond('audio/mpeg')).inject({ url: '/api/conversations/call-1/audio' });
    expect(res.headers.location).toBe(PAGE);
  });

  it('answers 502 when the page has no audio or the host fails, and 404 without a recording', async () => {
    expect((await setup(respond('text/html', '<p>expired</p>')).inject({ url: '/api/conversations/call-1/audio' })).statusCode).toBe(502);
    expect((await setup(respond('text/html', '', 403)).inject({ url: '/api/conversations/call-1/audio' })).statusCode).toBe(502);
    expect((await setup(respond('audio/mpeg'), null).inject({ url: '/api/conversations/call-1/audio' })).statusCode).toBe(404);
    expect((await setup(respond('audio/mpeg')).inject({ url: '/api/conversations/none/audio' })).statusCode).toBe(404);
  });

  it('ignores non-http sources', () => {
    expect(mediaSourceIn('<source src="javascript:alert(1)">', PAGE)).toBeNull();
    expect(mediaSourceIn('<source src="/rel/2.mp3">', PAGE)).toBe('https://player.example.invalid/rel/2.mp3');
  });
});
