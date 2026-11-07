import { readFileSync } from 'node:fs';
import { ACTOR_HEADER, DemoBundleSchema, ROLE_HEADER } from '@cqa/contracts';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db/index.js';
import { conversations } from '../src/db/schema.js';
import { insertEvaluation } from '../src/services/evaluations.js';

const bundle = DemoBundleSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/demo.json', import.meta.url), 'utf8')));
const base = bundle.evaluations[0]!;
const conv = bundle.conversations.find((c) => c.id === base.conversationId)!;

const as = (role: string, name = '') => ({ [ROLE_HEADER]: role, [ACTOR_HEADER]: encodeURIComponent(name) });
const operator = (name: string) => as('operator', name);
const reviewer = as('reviewer', 'Мария');
const lead = as('lead', 'Игорь');

function setup() {
  const db = openDb(':memory:');
  const app = buildApp({ db });
  db.insert(conversations).values({ id: conv.id, datasetGroupId: conv.datasetGroupId, language: conv.language, channel: conv.channel, audioUrl: conv.audioUrl, transcript: conv.transcript, importedAt: '2026-01-01T00:00:00.000Z' }).run();
  insertEvaluation(db, base);
  return { app, db };
}
const assign = (app: ReturnType<typeof setup>['app'], operatorName: string | null) =>
  app.inject({ method: 'POST', url: '/api/conversations/operator', headers: lead, payload: { conversationIds: [conv.id], operator: operatorName } });

describe('roles: what each one may do', () => {
  it('a request without a role stays unrestricted (scripts, exporter)', async () => {
    const { app } = setup();
    expect((await app.inject({ url: '/api/conversations' })).json()).toHaveLength(1);
    const res = await app.inject({ method: 'POST', url: `/api/evaluations/${base.id}/appeals`, payload: { criterionId: '04', comment: 'x' } });
    expect(res.statusCode).toBe(201);
  });

  it('only a lead assigns operators and edits the checklist; a reviewer does neither', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'POST', url: '/api/conversations/operator', headers: reviewer, payload: { conversationIds: [conv.id], operator: 'Алина' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/checklists', headers: reviewer, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/checklists', headers: operator('Алина'), payload: {} })).statusCode).toBe(403);
    expect((await assign(app, 'Алина')).statusCode).toBe(204);
    expect((await app.inject({ url: '/api/operators' })).json()).toEqual(['Алина']);
  });

  it('an operator sees only dialogs assigned to them, everywhere', async () => {
    const { app } = setup();
    const own = operator('Алина');
    // not assigned yet: nothing is visible, and the single reads answer 404 rather than leak
    expect((await app.inject({ url: '/api/conversations', headers: own })).json()).toEqual([]);
    expect((await app.inject({ url: `/api/conversations/${conv.id}`, headers: own })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/evaluations/${base.id}`, headers: own })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/evaluations', headers: own })).json()).toEqual([]);
    await assign(app, 'Алина');
    expect((await app.inject({ url: '/api/conversations', headers: own })).json()).toHaveLength(1);
    expect((await app.inject({ url: `/api/evaluations/${base.id}`, headers: own })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/evaluations', headers: own })).json()).toHaveLength(1);
    expect((await app.inject({ url: '/api/conversations', headers: operator('Тимур') })).json()).toEqual([]);
    expect((await app.inject({ url: '/api/conversations', headers: reviewer })).json()).toHaveLength(1);
  });

  it('the operator files and tracks appeals on their own dialogs; reviewers decide them', async () => {
    const { app } = setup();
    await assign(app, 'Алина');
    const file = (headers: Record<string, string>) => app.inject({ method: 'POST', url: `/api/evaluations/${base.id}/appeals`, headers, payload: { criterionId: '04', comment: 'Вопрос закрыт' } });
    expect((await file(reviewer)).statusCode).toBe(403); // reviewers correct directly, they do not appeal
    expect((await file(operator('Тимур'))).statusCode).toBe(404); // someone else's dialog
    const made = await file(operator('Алина'));
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ status: 'pending', createdBy: 'Алина' });

    expect((await app.inject({ url: '/api/appeals', headers: operator('Тимур') })).json()).toEqual([]);
    expect((await app.inject({ url: '/api/appeals', headers: operator('Алина') })).json()).toHaveLength(1);
    expect((await app.inject({ url: `/api/evaluations/${base.id}/appeals`, headers: operator('Тимур') })).statusCode).toBe(404);

    const decide = (headers: Record<string, string>) => app.inject({ method: 'POST', url: `/api/appeals/${made.json().id}/decision`, headers, payload: { action: 'uphold', reason: 'Оценка верна' } });
    expect((await decide(operator('Алина'))).statusCode).toBe(403);
    const decided = await decide(reviewer);
    expect(decided.json()).toMatchObject({ status: 'upheld', decidedBy: 'Мария', createdBy: 'Алина' });
  });

  it('an operator cannot correct a grade or start an evaluation', async () => {
    const { app } = setup();
    await assign(app, 'Алина');
    const own = operator('Алина');
    expect((await app.inject({ method: 'POST', url: `/api/evaluations/${base.id}/overrides`, headers: own, payload: { criterionId: '04', reason: 'x', value: 20 } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/evaluations', headers: own, payload: { conversationIds: [conv.id], checklistVersionId: base.checklistVersionId } })).statusCode).toBe(403);
  });
});

describe('review state', () => {
  const review = (app: ReturnType<typeof setup>['app'], status: string, headers: Record<string, string> = reviewer) => app.inject({ method: 'POST', url: `/api/conversations/${conv.id}/review`, headers, payload: { status } });
  const view = async (app: ReturnType<typeof setup>['app']) => (await app.inject({ url: `/api/conversations/${conv.id}` })).json();

  it('is new until someone takes it, bound to the evaluation looked at, and can be reopened', async () => {
    const { app } = setup();
    expect((await view(app)).review).toBeUndefined();
    expect((await review(app, 'in_review')).json().review).toMatchObject({ status: 'in_review', by: 'Мария', evaluationId: base.id });
    expect((await review(app, 'reviewed', lead)).json().review).toMatchObject({ status: 'reviewed', by: 'Игорь', evaluationId: base.id });
    expect((await review(app, 'new')).json().review).toBeUndefined();
  });

  it('operators cannot mark a dialog; a dialog without an evaluation cannot be reviewed', async () => {
    const { app, db } = setup();
    await assign(app, 'Алина');
    expect((await review(app, 'reviewed', operator('Алина'))).statusCode).toBe(403);
    expect((await review(app, 'bogus')).statusCode).toBe(400);
    db.delete((await import('../src/db/schema.js')).evaluations).run();
    expect((await review(app, 'reviewed')).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/conversations/none/review', headers: reviewer, payload: { status: 'reviewed' } })).statusCode).toBe(404);
  });

  it('changing one criterion puts the dialog in review but does not mark it reviewed', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url: `/api/evaluations/${base.id}/overrides`, headers: reviewer, payload: { criterionId: '04', reason: 'Согласен', value: 20 } });
    expect(res.json()).toMatchObject({ kind: 'correction', decidedBy: 'Мария' });
    expect((await view(app)).review).toMatchObject({ status: 'in_review', by: 'Мария' });
    await review(app, 'reviewed');
    await app.inject({ method: 'POST', url: `/api/evaluations/${base.id}/overrides`, headers: reviewer, payload: { criterionId: '04', reason: 'Ещё раз', value: 10 } });
    expect((await view(app)).review.status).toBe('reviewed'); // a later tweak does not undo an explicit check
  });
});

describe('re-import', () => {
  it('keeps importedAt and the operator assignment of a dialog that is imported again', async () => {
    const records = [{ conversation_id: 'z-1', channel: 'agent chat', language: 'RU', audio_url: null, transcript: [{ timestamp: '00:01', speaker: 'client', text: 'a' }, { timestamp: '00:02', speaker: 'operator', text: 'b' }] }];
    const body = { isSuccess: true, error: '', data: { dataset_group_id: 'G1', total_records: 1, records } };
    const app = buildApp({ db: openDb(':memory:'), importDeps: { baseUrl: 'https://example.invalid/x?group_id=G1', fetch: async () => new Response(JSON.stringify(body)), retryDelayMs: 1 } });
    const imp = () => app.inject({ method: 'POST', url: '/api/datasets/import', headers: lead, payload: { groupId: 'G1' } });
    expect((await imp()).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/conversations/operator', headers: lead, payload: { conversationIds: ['z-1'], operator: 'Алина' } });
    const first = (await app.inject({ url: '/api/conversations/z-1' })).json();
    await new Promise((r) => setTimeout(r, 5));
    expect((await imp()).statusCode).toBe(200);
    const again = (await app.inject({ url: '/api/conversations/z-1' })).json();
    expect(again.importedAt).toBe(first.importedAt);
    expect(again.operatorId).toBe('Алина');
    expect((await app.inject({ method: 'POST', url: '/api/datasets/import', headers: reviewer, payload: { groupId: 'G1' } })).statusCode).toBe(403);
  });
});
