import { readFileSync } from 'node:fs';
import { DemoBundleSchema, computeTotal } from '@cqa/contracts';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db/index.js';
import { insertEvaluation } from '../src/services/evaluations.js';
import { ORIGINAL_CHECKLIST } from '../src/services/checklists.js';

const bundle = DemoBundleSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/demo.json', import.meta.url), 'utf8')));
const base = bundle.evaluations[0]!;

function setup() {
  const db = openDb(':memory:');
  const app = buildApp({ db });
  insertEvaluation(db, base);
  return app;
}
const appeal = (app: ReturnType<typeof setup>, criterionId = '04', comment = 'Все вопросы закрыты') =>
  app.inject({ method: 'POST', url: `/api/evaluations/${base.id}/appeals`, payload: { criterionId, comment } });
const decide = (app: ReturnType<typeof setup>, id: string, payload: object) => app.inject({ method: 'POST', url: `/api/appeals/${id}/decision`, payload });
const evaluation = async (app: ReturnType<typeof setup>) => (await app.inject({ url: `/api/evaluations/${base.id}` })).json();

describe('evaluations + appeals', () => {
  it('serves stored evaluations', async () => {
    const app = setup();
    expect((await evaluation(app)).originalTotal).toBe(94.12);
    expect((await app.inject({ url: `/api/evaluations?conversationId=${base.conversationId}` })).json()).toHaveLength(1);
    expect((await app.inject({ url: '/api/evaluations?conversationId=other' })).json()).toEqual([]);
    expect((await app.inject({ url: '/api/evaluations/none' })).statusCode).toBe(404);
  });

  it('override recomputes the final total and never touches the originals', async () => {
    const app = setup();
    const a = (await appeal(app)).json();
    expect(a.status).toBe('pending');
    const res = await decide(app, a.id, { action: 'override', reason: 'Согласен', value: 20 });
    expect(res.json()).toMatchObject({ status: 'overridden', reviewerValue: 20 });
    const ev = await evaluation(app);
    expect(ev.originalResults).toEqual(base.originalResults);
    expect(ev.originalTotal).toBe(94.12);
    expect(ev.finalTotal).toBe(100);
    expect(ev.finalTotal).toBe(computeTotal(ORIGINAL_CHECKLIST.criteria, ev.finalResults));
    expect(ev.finalResults.find((r: { criterionId: string }) => r.criterionId === '04').explanation).toContain('Reviewer override');
  });

  it('uphold keeps both results identical and records the decision', async () => {
    const app = setup();
    const a = (await appeal(app)).json();
    const res = (await decide(app, a.id, { action: 'uphold', reason: 'ИИ прав' })).json();
    expect(res).toMatchObject({ status: 'upheld', reviewerReason: 'ИИ прав' });
    expect(res.decidedAt).toBeTruthy();
    const ev = await evaluation(app);
    expect(ev.finalResults).toEqual(ev.originalResults);
    expect(ev.finalTotal).toBe(94.12);
  });

  it('an override to N/A redistributes weight; a flag override sets seriousViolation on the final side only', async () => {
    const app = setup();
    const n = (await appeal(app, '07')).json();
    await decide(app, n.id, { action: 'override', reason: 'чат оборвался', isNA: true });
    const flag = (await appeal(app, '08', 'Оператор грубил')).json();
    await decide(app, flag.id, { action: 'override', reason: 'подтверждено', value: true });
    const ev = await evaluation(app);
    expect(ev.finalResults.find((r: { criterionId: string }) => r.criterionId === '07')).toMatchObject({ isNA: true, value: null });
    expect(ev.finalTotal).toBe(computeTotal(ORIGINAL_CHECKLIST.criteria, ev.finalResults));
    expect(ev.seriousViolation).toBe(true);
    expect(ev.originalResults).toEqual(base.originalResults);
  });

  it('invalid overrides change nothing and leave the appeal pending', async () => {
    const app = setup();
    const a = (await appeal(app)).json();
    expect((await decide(app, a.id, { action: 'override', reason: 'r', value: 7 })).statusCode).toBe(400); // not a tier
    expect((await decide(app, a.id, { action: 'override', reason: 'r' })).statusCode).toBe(400); // no value
    const f = (await appeal(app, '01')).json();
    expect((await decide(app, f.id, { action: 'override', reason: 'r', isNA: true })).statusCode).toBe(400); // N/A not allowed on 01
    const ev = await evaluation(app);
    expect(ev.finalResults).toEqual(ev.originalResults);
    expect((await app.inject({ url: `/api/evaluations/${base.id}/appeals` })).json().map((x: { status: string }) => x.status)).toEqual(['pending', 'pending']);
  });

  it('guards: unknown ids, wrong criterion, duplicate pending, double decision', async () => {
    const app = setup();
    expect((await app.inject({ method: 'POST', url: '/api/evaluations/none/appeals', payload: { criterionId: '04', comment: 'c' } })).statusCode).toBe(404);
    expect((await appeal(app, 'zz')).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/api/evaluations/${base.id}/appeals`, payload: { criterionId: '04' } })).statusCode).toBe(400);
    const a = (await appeal(app)).json();
    expect((await appeal(app)).statusCode).toBe(409);
    expect((await decide(app, 'nope', { action: 'uphold', reason: 'r' })).statusCode).toBe(404);
    await decide(app, a.id, { action: 'uphold', reason: 'r' });
    expect((await decide(app, a.id, { action: 'uphold', reason: 'r' })).statusCode).toBe(409);
    expect((await appeal(app)).statusCode).toBe(201); // a new appeal is allowed once the earlier one is decided
  });

  it('a later checklist version does not affect an existing evaluation', async () => {
    const app = setup();
    const { id: _i, version: _v, createdAt: _c, ...rest } = ORIGINAL_CHECKLIST;
    await app.inject({ method: 'POST', url: '/api/checklists', payload: { ...rest, criteria: rest.criteria.map((c) => (c.id === '04' ? { ...c, weight: 50 } : c)) } });
    const a = (await appeal(app)).json();
    await decide(app, a.id, { action: 'override', reason: 'r', value: 10 });
    expect((await evaluation(app)).finalTotal).toBe(88.24); // v1 weights (v2 would give 78.26)
  });

  it('lists appeals across evaluations for the approver, oldest first, filtered by status', async () => {
    const app = setup();
    const a = (await appeal(app, '04', 'первое')).json();
    const b = (await appeal(app, '05', 'второе')).json();
    await decide(app, a.id, { action: 'uphold', reason: 'ИИ прав' });
    const all = (await app.inject({ url: '/api/appeals' })).json();
    expect(all.map((x: { id: string }) => x.id)).toEqual([a.id, b.id]);
    const pending = (await app.inject({ url: '/api/appeals?status=pending' })).json();
    expect(pending.map((x: { id: string }) => x.id)).toEqual([b.id]);
    const decided = (await app.inject({ url: '/api/appeals?status=upheld' })).json();
    expect(decided[0]).toMatchObject({ id: a.id, status: 'upheld', reviewerReason: 'ИИ прав' });
    expect((await app.inject({ url: '/api/appeals?status=nonsense' })).statusCode).toBe(400);
  });

  it('a criterion can be appealed again after a decision, and two overrides in a row keep the originals and both decisions', async () => {
    const app = setup();
    const first = (await appeal(app, '04')).json();
    await decide(app, first.id, { action: 'override', reason: 'первое решение', value: 20 });
    const second = (await appeal(app, '04', 'снова')).json();
    expect(second.status).toBe('pending');
    await decide(app, second.id, { action: 'override', reason: 'второе решение', value: 10 });
    const ev = await evaluation(app);
    expect(ev.finalResults.find((r: { criterionId: string }) => r.criterionId === '04')).toMatchObject({ value: 10 });
    expect(ev.finalTotal).toBe(computeTotal(ORIGINAL_CHECKLIST.criteria, ev.finalResults));
    expect(ev.originalResults).toEqual(base.originalResults);
    expect(ev.originalTotal).toBe(base.originalTotal);
    const history = (await app.inject({ url: `/api/evaluations/${base.id}/appeals` })).json();
    expect(history.map((x: { reviewerReason: string }) => x.reviewerReason)).toEqual(['первое решение', 'второе решение']);
  });

  it('an appeal on an evaluation that is not completed is refused', async () => {
    const db = openDb(':memory:');
    const app = buildApp({ db });
    insertEvaluation(db, { ...base, id: 'eval-failed', status: 'failed', originalResults: [], originalTotal: null, finalResults: [], finalTotal: null, error: 'x' });
    const res = await app.inject({ method: 'POST', url: '/api/evaluations/eval-failed/appeals', payload: { criterionId: '04', comment: 'c' } });
    expect(res.statusCode).toBe(409);
  });
});
