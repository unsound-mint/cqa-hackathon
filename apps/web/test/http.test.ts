import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTOR_HEADER, ROLE_HEADER } from '@cqa/contracts';
import demoBundle from '../../../fixtures/demo.json';
import { asRole, withOperator } from './roles';
import { CqaApiError, HttpCqaApi, MockCqaApi, createApi } from '../src/api';

type Call = { url: string; method?: string; headers?: HeadersInit; body?: unknown };

function setup(status: number, payload: unknown) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body === undefined ? undefined : JSON.parse(init.body as string) });
    return new Response(status === 204 ? null : JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { api: new HttpCqaApi({ fetch: fetchFn }), calls };
}

// Valid payloads come from the mock (fictional fixture), so they match the shared contracts.
const mock = new MockCqaApi();

describe('HttpCqaApi', () => {
  beforeEach(() => asRole('lead'));

  it('sends the picked role and name with every call (the name URI-encoded: header values are Latin-1)', async () => {
    asRole('operator', 'Алина');
    const { api, calls } = setup(200, []);
    await api.listConversations();
    const h = new Headers(calls[0]!.headers);
    expect(h.get(ROLE_HEADER)).toBe('operator');
    expect(decodeURIComponent(h.get(ACTOR_HEADER)!)).toBe('Алина');
  });

  it('review and assignment are POSTs (the embedded app allows only GET/POST across origins) and a 403 is its own error', async () => {
    const conv = await mock.getConversation('demo-ru-001');
    const r = setup(200, conv);
    await r.api.setReview('demo-ru-001', { status: 'reviewed' });
    expect(r.calls[0]).toMatchObject({ url: '/api/conversations/demo-ru-001/review', method: 'POST', body: { status: 'reviewed' } });
    const a = setup(204, null);
    await a.api.assignOperator({ conversationIds: ['demo-ru-001'], operator: 'Алина' });
    expect(a.calls[0]).toMatchObject({ url: '/api/conversations/operator', method: 'POST' });
    await expect(setup(403, { error: 'Роль «Оператор» не может менять оценки' }).api.overrideCriterion({ evaluationId: 'e', criterionId: 'c', reason: 'r', value: 1 })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lists conversations with only the defined query params', async () => {
    const conv = await mock.getConversation('demo-ru-001');
    const { api, calls } = setup(200, [conv]);
    expect(await api.listConversations({ language: 'RU', channel: undefined })).toEqual([conv]);
    expect(calls[0]).toMatchObject({ url: '/api/conversations?language=RU', method: 'GET' });
    await api.listConversations();
    expect(calls[1]!.url).toBe('/api/conversations');
    await api.listConversations({ language: 'RU', channel: 'voice call' });
    expect(calls[2]!.url).toBe('/api/conversations?language=RU&channel=voice+call');
  });

  it('gets a conversation by encoded id', async () => {
    const conv = await mock.getConversation('demo-ru-001');
    const { api, calls } = setup(200, conv);
    expect(await api.getConversation('a/b c')).toEqual(conv);
    expect(calls[0]!.url).toBe('/api/conversations/a%2Fb%20c');
  });

  it('honours baseUrl and builds evaluation queries', async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      return new Response('[]', { status: 200 });
    }) as unknown as typeof fetch;
    const api = new HttpCqaApi({ baseUrl: 'http://x:1/', fetch: fetchFn });
    expect(await api.listEvaluations({ conversationId: 'c1' })).toEqual([]);
    expect(await api.listEvaluations({})).toEqual([]);
    expect(calls).toEqual(['http://x:1/api/evaluations?conversationId=c1', 'http://x:1/api/evaluations']);
  });

  it('saves a checklist with a JSON POST body', async () => {
    const [cl] = await mock.listChecklists();
    const { id: _id, version: _v, createdAt: _c, ...input } = cl!;
    const { api, calls } = setup(201, cl);
    expect(await api.saveChecklistVersion(input as never)).toEqual(cl);
    expect(calls[0]).toMatchObject({ url: '/api/checklists', method: 'POST', body: input });
    expect(new Headers(calls[0]!.headers).get('content-type')).toBe('application/json');
    const g = setup(200, [cl]);
    expect(await g.api.listChecklists()).toEqual([cl]);
    expect(g.calls[0]).toMatchObject({ url: '/api/checklists', method: 'GET', body: undefined });
  });

  it('starts an evaluation and polls the job', async () => {
    const s = setup(202, { jobId: 'j1' });
    const input = { conversationIds: ['c1'], checklistVersionId: 'v1' };
    expect(await s.api.startEvaluation(input)).toEqual({ jobId: 'j1' });
    expect(s.calls[0]).toMatchObject({ url: '/api/evaluations', method: 'POST', body: input });
    const job = { id: 'j1', status: 'running', completed: 0, total: 1, evaluationIds: [] };
    const j = setup(200, job);
    expect(await j.api.getJob('j1')).toEqual(job);
    expect(j.calls[0]!.url).toBe('/api/jobs/j1');
    await expect(setup(202, {}).api.startEvaluation(input)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('puts the evaluation id in the path for appeals and the appeal id in the path for decisions', async () => {
    const ev = (await mock.listEvaluations())[0]!;
    const crit = ev.originalResults[0]!.criterionId;
    asRole('operator');
    const appeal = await new MockCqaApi(withOperator(demoBundle)).createAppeal({ evaluationId: ev.id, criterionId: crit, comment: 'why' });
    const c = setup(201, appeal);
    expect(await c.api.createAppeal({ evaluationId: ev.id, criterionId: crit, comment: 'why' })).toEqual(appeal);
    expect(c.calls[0]).toMatchObject({ url: `/api/evaluations/${ev.id}/appeals`, method: 'POST', body: { criterionId: crit, comment: 'why' } });
    expect(c.calls[0]!.body).not.toHaveProperty('evaluationId');

    const d = setup(200, appeal);
    expect(await d.api.decideAppeal({ appealId: appeal.id, action: 'uphold', reason: 'r' })).toEqual(appeal);
    expect(d.calls[0]).toMatchObject({ url: `/api/appeals/${appeal.id}/decision`, method: 'POST', body: { action: 'uphold', reason: 'r' } });
    expect(d.calls[0]!.body).not.toHaveProperty('appealId');

    asRole('reviewer');
    const correction = await new MockCqaApi(withOperator(demoBundle)).overrideCriterion({ evaluationId: ev.id, criterionId: crit, reason: 'r', isNA: false, value: false });
    const o = setup(201, correction);
    expect(await o.api.overrideCriterion({ evaluationId: ev.id, criterionId: crit, reason: 'r', value: false, isNA: false })).toEqual(correction);
    expect(o.calls[0]).toMatchObject({ url: `/api/evaluations/${ev.id}/overrides`, method: 'POST', body: { criterionId: crit, reason: 'r', value: false } });
    expect(o.calls[0]!.body).not.toHaveProperty('evaluationId');

    const l = setup(200, [appeal]);
    expect(await l.api.listAppeals({ evaluationId: ev.id })).toEqual([appeal]);
    expect(l.calls[0]).toMatchObject({ url: `/api/evaluations/${ev.id}/appeals`, method: 'GET' });
  });

  it.each([
    [404, 'not_found'],
    [400, 'invalid'],
    [409, 'conflict'],
  ])('maps HTTP %i to CqaApiError(%s) with the server message', async (status, code) => {
    const { api } = setup(status, { error: 'nope' });
    const err = await api.getEvaluation('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CqaApiError);
    expect(err).toMatchObject({ code, message: 'nope' });
  });

  it('throws a plain Error for other statuses and network failures', async () => {
    const err = await setup(500, { error: 'boom' }).api.getJob('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(CqaApiError);
    const down = new HttpCqaApi({ fetch: (async () => { throw new TypeError('failed'); }) as unknown as typeof fetch });
    const e2 = await down.listChecklists().catch((e: unknown) => e);
    expect(e2).toBeInstanceOf(Error);
    expect(e2).not.toBeInstanceOf(CqaApiError);
  });

  it('rejects a malformed 2xx response as invalid', async () => {
    await expect(setup(200, [{ id: 1 }]).api.listConversations()).rejects.toMatchObject({ code: 'invalid' });
    await expect(setup(200, { nope: true }).api.getEvaluation('e')).rejects.toMatchObject({ code: 'invalid' });
  });

  it('plays calls through the API audio route (it resolves the organizer player page); nothing for chats', async () => {
    const conv = await mock.getConversation('demo-ru-001');
    const api = new HttpCqaApi({ baseUrl: 'http://h' });
    expect(api.audioSrc({ ...conv, id: 'a b', audioUrl: 'https://example.invalid/page' })).toBe('http://h/api/conversations/a%20b/audio');
    expect(api.audioSrc({ ...conv, audioUrl: null })).toBeNull();
  });

  it('lists appeals across dialogs for the approver, with an optional status', async () => {
    const { api, calls } = setup(200, []);
    await api.listAppeals();
    await api.listAppeals({ status: 'pending' });
    expect(calls.map((c) => c.url)).toEqual(['/api/appeals', '/api/appeals?status=pending']);
  });
});


describe('API selection for launch', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('uses the real backend by default in the production build used by pnpm start', () => {
    vi.stubEnv('VITE_API_MODE', ''); vi.stubEnv('PROD', true);
    expect(createApi()).toBeInstanceOf(HttpCqaApi);
  });
  it('retains development mock mode and an explicit preview override', () => {
    vi.stubEnv('VITE_API_MODE', ''); vi.stubEnv('PROD', false);
    expect(createApi()).toBeInstanceOf(MockCqaApi);
    vi.stubEnv('VITE_API_MODE', 'mock'); vi.stubEnv('PROD', true);
    expect(createApi()).toBeInstanceOf(MockCqaApi);
  });
});
