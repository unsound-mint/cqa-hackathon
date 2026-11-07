import { describe, expect, it } from 'vitest';
import { CqaApiError, HttpCqaApi, MockCqaApi } from '../src/api';

type Call = { url: string; method?: string; headers?: HeadersInit; body?: unknown };

function setup(status: number, payload: unknown) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body === undefined ? undefined : JSON.parse(init.body as string) });
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { api: new HttpCqaApi({ fetch: fetchFn }), calls };
}

// Valid payloads come from the mock (fictional fixture), so they match the shared contracts.
const mock = new MockCqaApi();

describe('HttpCqaApi', () => {
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
    const appeal = await new MockCqaApi().createAppeal({ evaluationId: ev.id, criterionId: crit, comment: 'why' });
    const c = setup(201, appeal);
    expect(await c.api.createAppeal({ evaluationId: ev.id, criterionId: crit, comment: 'why' })).toEqual(appeal);
    expect(c.calls[0]).toMatchObject({ url: `/api/evaluations/${ev.id}/appeals`, method: 'POST', body: { criterionId: crit, comment: 'why' } });
    expect(c.calls[0]!.body).not.toHaveProperty('evaluationId');

    const d = setup(200, appeal);
    expect(await d.api.decideAppeal({ appealId: appeal.id, action: 'uphold', reason: 'r' })).toEqual(appeal);
    expect(d.calls[0]).toMatchObject({ url: `/api/appeals/${appeal.id}/decision`, method: 'POST', body: { action: 'uphold', reason: 'r' } });
    expect(d.calls[0]!.body).not.toHaveProperty('appealId');

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

  it('lists appeals across dialogs for the approver, with an optional status', async () => {
    const { api, calls } = setup(200, []);
    await api.listAppeals();
    await api.listAppeals({ status: 'pending' });
    expect(calls.map((c) => c.url)).toEqual(['/api/appeals', '/api/appeals?status=pending']);
  });
});

