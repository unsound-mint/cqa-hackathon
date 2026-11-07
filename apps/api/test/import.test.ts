import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db/index.js';
import { parseDataset } from '../src/services/import/dataset.js';
import { urlForGroup } from '../src/services/import/importer.js';

const SECRET = 'https://example.invalid/invoke?sig=TOPSECRET&group_id=DEV';
const rec = (id: string, extra: object = {}) => ({
  conversation_id: id,
  channel: 'agent chat',
  language: 'KZ',
  audio_url: null,
  transcript: [
    { timestamp: '2026-01-01T10:00:00.000Z', speaker: 'bot', text: 'Сәлем' },
    { timestamp: '2026-01-01T10:00:00.000Z', speaker: 'client', text: 'Hi\nthere  ' },
    { timestamp: '00:05', speaker: 'operator', text: 'Hello' },
  ],
  ...extra,
});
const envelope = (records: unknown[]) => ({ isSuccess: true, error: '', data: { dataset_group_id: 'G1', total_records: records.length, records } });
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

function appWith(fetchImpl: typeof fetch, baseUrl: string | null = SECRET) {
  return buildApp({ db: openDb(':memory:'), importDeps: { baseUrl: baseUrl ?? undefined, fetch: fetchImpl, retryDelayMs: 1 } });
}

describe('parseDataset', () => {
  it('keeps text/order/timestamps/audio exactly and adds zero-based indices', () => {
    const r = rec('a', { audio_url: 'https://audio.invalid/x.mp3' });
    const { conversations, failed } = parseDataset(envelope([r]), 'G1');
    expect(failed).toEqual([]);
    expect(conversations[0]!.transcript.map((m) => [m.index, m.timestamp, m.speaker, m.text])).toEqual(
      r.transcript.map((m, i) => [i, m.timestamp, m.speaker, m.text]),
    );
    expect(conversations[0]!.audioUrl).toBe('https://audio.invalid/x.mp3');
  });

  it('reports bad records without dropping the good ones', () => {
    const bad = [rec('b1', { language: 'FR' }), rec('b2', { transcript: [{ timestamp: '0', speaker: 'robot', text: 'x' }] }), { nope: 1 }, rec('dup'), rec('dup'), rec('good')];
    const { conversations, failed, total } = parseDataset(envelope(bad), 'G1');
    expect(conversations.map((c) => c.id)).toEqual(['dup', 'good']);
    expect(failed).toHaveLength(4);
    expect(total).toBe(6);
  });

  it('rejects a response without data.records', () => {
    expect(() => parseDataset({ data: {} }, 'G1')).toThrow();
    expect(() => parseDataset({ isSuccess: false, data: { records: [] } }, 'G1')).toThrow();
  });
});

describe('POST /api/datasets/import', () => {
  it('overrides group_id in the configured URL', () => {
    expect(new URL(urlForGroup(SECRET, 'CONTROL')).searchParams.get('group_id')).toBe('CONTROL');
    expect(new URL(urlForGroup(SECRET, 'CONTROL')).searchParams.get('sig')).toBe('TOPSECRET');
  });

  it('imports, serves the data back with filters, and is idempotent', async () => {
    const f = vi.fn(async (_url: string) => ok(envelope([rec('c1'), rec('c2', { language: 'EN', channel: 'voice call', audio_url: 'https://a.invalid/1' })])));
    const app = appWith(f as unknown as typeof fetch);
    const first = await app.inject({ method: 'POST', url: '/api/datasets/import', payload: { groupId: 'CONTROL' } });
    expect(first.json()).toMatchObject({ groupId: 'CONTROL', total: 2, imported: 2, failed: [] });
    expect(String(f.mock.calls[0]![0])).toContain('group_id=CONTROL');
    await app.inject({ method: 'POST', url: '/api/datasets/import', payload: { groupId: 'CONTROL' } });

    expect((await app.inject({ url: '/api/conversations' })).json()).toHaveLength(2);
    expect((await app.inject({ url: '/api/conversations?language=EN' })).json().map((c: { id: string }) => c.id)).toEqual(['c2']);
    const one = (await app.inject({ url: '/api/conversations/c1' })).json();
    expect(one.transcript[1].text).toBe('Hi\nthere  ');
    expect((await app.inject({ url: '/api/conversations/missing' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/conversations?language=FR' })).statusCode).toBe(400);
  });

  it('retries 5xx with bounded attempts, then fails without leaking the URL', async () => {
    const f = vi.fn(async () => new Response('boom', { status: 500 }));
    const app = appWith(f as unknown as typeof fetch);
    const res = await app.inject({ method: 'POST', url: '/api/datasets/import', payload: { groupId: 'DEV' } });
    expect(res.statusCode).toBe(502);
    expect(f).toHaveBeenCalledTimes(4);
    expect(res.body).not.toContain('TOPSECRET');
  });

  it('recovers after a transient failure and does not retry a 403', async () => {
    let n = 0;
    const flaky = vi.fn(async () => (n++ === 0 ? new Response('x', { status: 503 }) : ok(envelope([rec('r1')]))));
    expect((await appWith(flaky as unknown as typeof fetch).inject({ method: 'POST', url: '/api/datasets/import', payload: { groupId: 'DEV' } })).json().imported).toBe(1);
    const denied = vi.fn(async () => new Response('no', { status: 403 }));
    expect((await appWith(denied as unknown as typeof fetch).inject({ method: 'POST', url: '/api/datasets/import', payload: { groupId: 'DEV' } })).statusCode).toBe(502);
    expect(denied).toHaveBeenCalledTimes(1);
  });

  it('validates input and configuration', async () => {
    const app = appWith(vi.fn() as unknown as typeof fetch);
    expect((await app.inject({ method: 'POST', url: '/api/datasets/import', payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/datasets/import', payload: { groupId: 'a&b=c' } })).statusCode).toBe(400);
    const unconfigured = appWith(vi.fn() as unknown as typeof fetch, null);
    expect((await unconfigured.inject({ method: 'POST', url: '/api/datasets/import', payload: { groupId: 'DEV' } })).statusCode).toBe(503);
  });
});

describe('immutable evidence sources', () => {
  it('rejects changed re-imports atomically without replacing original text', async () => {
    let records = [rec('original')];
    const app = appWith((async () => ok(envelope(records))) as typeof fetch);
    const request = () => app.inject({method:'POST',url:'/api/datasets/import',payload:{groupId:'G1'}});
    expect((await request()).statusCode).toBe(200);
    records = [rec('new'), rec('original', {transcript:[{timestamp:'00:00',speaker:'bot',text:'changed'}]})];
    expect((await request()).statusCode).toBe(409);
    expect((await app.inject({url:'/api/conversations/original'})).json().transcript[0].text).toBe('Сәлем');
    expect((await app.inject({url:'/api/conversations/new'})).statusCode).toBe(404);
  });
});
