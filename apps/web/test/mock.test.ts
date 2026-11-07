import { beforeEach, describe, expect, it } from 'vitest';
import { computeTotal } from '@cqa/contracts';
import demo from '../../../fixtures/demo.json';
import { CqaApiError, MockCqaApi } from '../src/api';
import { asRole, withOperator } from './roles';

describe('MockCqaApi', () => {
  beforeEach(() => asRole('lead'));

  it('loads the fictional conversation with no network', async () => {
    const api = new MockCqaApi();
    const [c] = await api.listConversations({ language: 'RU' });
    expect(c?.transcript.length).toBeGreaterThan(0);
    expect(await api.listConversations({ language: 'EN' })).toEqual([]);
  });

  it('returns copies: mutating a result does not change mock state', async () => {
    const api = new MockCqaApi();
    const c = await api.getConversation('demo-ru-001');
    c.transcript[0]!.text = 'tampered';
    expect((await api.getConversation('demo-ru-001')).transcript[0]!.text).not.toBe('tampered');
  });

  it('saves a changed checklist as a new version and evaluates against ITS criteria', async () => {
    const api = new MockCqaApi();
    const [v1] = await api.listChecklists();
    const { id: _i, version: _v, createdAt: _c, ...rest } = v1!;
    const edited = {
      ...rest,
      criteria: [...rest.criteria, { id: 'x9', title: 'Новый критерий', instructions: 'любой текст', weight: 10, kind: 'discrete-scale' as const, allowedValues: [0, 1, 2], allowNA: false }],
    };
    const v2 = await api.saveChecklistVersion(edited);
    expect(v2.version).toBe(2);
    expect((await api.listChecklists()).find((c) => c.id === v1!.id)!.criteria).toHaveLength(8); // v1 untouched

    const { jobId } = await api.startEvaluation({ conversationIds: ['demo-ru-001'], checklistVersionId: v2.id });
    const job = await api.getJob(jobId);
    expect(job.status).toBe('completed');
    const ev = await api.getEvaluation(job.evaluationIds[0]!);
    expect(ev.originalResults.map((r) => r.criterionId)).toContain('x9');
    expect(ev.provenance?.provider).toBe('mock');
  });

  it('override recalculates final total but never touches the original evaluation', async () => {
    const api = new MockCqaApi(withOperator(demo));
    asRole('operator');
    const before = (await api.listEvaluations())[0]!;
    const appeal = await api.createAppeal({ evaluationId: before.id, criterionId: '04', comment: 'Все вопросы закрыты' });
    expect(appeal.status).toBe('pending');
    asRole('reviewer');
    const decided = await api.decideAppeal({ appealId: appeal.id, action: 'override', reason: 'Согласен', value: 20 });
    expect(decided.status).toBe('overridden');

    const after = await api.getEvaluation(before.id);
    expect(after.originalResults).toEqual(before.originalResults);
    expect(after.originalTotal).toBe(before.originalTotal);
    const [checklist] = await api.listChecklists();
    expect(after.finalTotal).toBe(computeTotal(checklist!.criteria, after.finalResults));
    expect(after.finalTotal).toBeGreaterThan(before.finalTotal!);
    await expect(api.decideAppeal({ appealId: appeal.id, action: 'uphold', reason: 'x' })).rejects.toBeInstanceOf(CqaApiError);
  });

  it('rejects an invalid override without recording a decision', async () => {
    const api = new MockCqaApi(withOperator(demo));
    asRole('operator');
    const ev = (await api.listEvaluations())[0]!;
    const a = await api.createAppeal({ evaluationId: ev.id, criterionId: '04', comment: 'c' });
    asRole('reviewer');
    await expect(api.decideAppeal({ appealId: a.id, action: 'override', reason: 'r', value: 7 })).rejects.toBeInstanceOf(CqaApiError);
    expect((await api.listAppeals({ evaluationId: ev.id }))[0]!.status).toBe('pending');
  });

  it('a direct correction keeps the AI explanation in the originals and records a decided correction', async () => {
    const api = new MockCqaApi(withOperator(demo));
    asRole('reviewer');
    const before = (await api.listEvaluations())[0]!;
    const c = await api.overrideCriterion({ evaluationId: before.id, criterionId: '04', reason: 'Вопросы закрыты', value: 20 });
    expect(c).toMatchObject({ kind: 'correction', status: 'overridden', reviewerReason: 'Вопросы закрыты' });
    const after = await api.getEvaluation(before.id);
    expect(after.originalResults).toEqual(before.originalResults);
    expect(after.finalResults.find((r) => r.criterionId === '04')).toMatchObject({ value: 20, explanation: 'Вопросы закрыты', source: 'reviewer' });
    asRole('operator');
    const appeal = await api.createAppeal({ evaluationId: before.id, criterionId: '05', comment: 'c' });
    asRole('reviewer');
    await expect(api.overrideCriterion({ evaluationId: before.id, criterionId: '05', reason: 'r', value: true })).rejects.toMatchObject({ code: 'conflict' });
    expect((await api.listAppeals({ evaluationId: before.id })).find((a) => a.id === appeal.id)!.status).toBe('pending');
  });
});

describe('MockCqaApi roles (the same rules as the API)', () => {
  beforeEach(() => asRole('lead'));
  const setup = () => new MockCqaApi(withOperator(demo, 'Алина'));

  it('an operator sees only their own dialogs, evaluations and appeals', async () => {
    const api = setup();
    asRole('operator', 'Тимур');
    expect(await api.listConversations()).toEqual([]);
    expect(await api.listEvaluations()).toEqual([]);
    await expect(api.getConversation('demo-ru-001')).rejects.toMatchObject({ code: 'not_found' });
    asRole('operator', 'Алина');
    expect(await api.listConversations()).toHaveLength(1);
    expect(await api.listEvaluations()).toHaveLength(1);
  });

  it('only an operator appeals; only reviewer and lead correct, decide and mark; only the lead edits the checklist and assigns', async () => {
    const api = setup();
    const ev = (await api.listEvaluations())[0]!;
    asRole('reviewer');
    await expect(api.createAppeal({ evaluationId: ev.id, criterionId: '04', comment: 'c' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(api.saveChecklistVersion({})).rejects.toMatchObject({ code: 'forbidden' });
    await expect(api.assignOperator({ conversationIds: ['demo-ru-001'], operator: 'Тимур' })).rejects.toMatchObject({ code: 'forbidden' });
    asRole('operator');
    await expect(api.overrideCriterion({ evaluationId: ev.id, criterionId: '04', reason: 'r', value: 20 })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(api.setReview('demo-ru-001', { status: 'reviewed' })).rejects.toMatchObject({ code: 'forbidden' });
    asRole('lead');
    await api.assignOperator({ conversationIds: ['demo-ru-001'], operator: 'Тимур' });
    expect(await api.listOperators()).toEqual(['Тимур']);
  });

  it('a review is bound to the evaluation; a correction puts the dialog in review but never finishes it', async () => {
    const api = setup();
    const ev = (await api.listEvaluations())[0]!;
    asRole('reviewer', 'Мария');
    await api.overrideCriterion({ evaluationId: ev.id, criterionId: '04', reason: 'r', value: 20 });
    expect((await api.getConversation('demo-ru-001')).review).toMatchObject({ status: 'in_review', evaluationId: ev.id, by: 'Мария' });
    expect((await api.setReview('demo-ru-001', { status: 'reviewed' })).review).toMatchObject({ status: 'reviewed', evaluationId: ev.id });
    expect((await api.setReview('demo-ru-001', { status: 'new' })).review).toBeUndefined();
  });
});
