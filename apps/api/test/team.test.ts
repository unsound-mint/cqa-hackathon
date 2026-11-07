import { readFileSync } from 'node:fs';
import { ACTOR_HEADER, DemoBundleSchema, PERSON_HEADER, ROLE_HEADER, type Evaluation } from '@cqa/contracts';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db/index.js';
import { conversations, operatorAssignments, people, teams } from '../src/db/schema.js';
import { insertEvaluation } from '../src/services/evaluations.js';

const bundle = DemoBundleSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/demo.json', import.meta.url), 'utf8')));
const base = bundle.evaluations[0]!;
const conv = bundle.conversations.find((c) => c.id === base.conversationId)!;

const who = (role: string, id?: string, name = id ?? '') => ({ [ROLE_HEADER]: role, [ACTOR_HEADER]: encodeURIComponent(name), ...(id ? { [PERSON_HEADER]: id } : {}) });
const lead = who('lead', 'lead-1');
const mgr = who('manager', 'mgr-1');
const qa1 = who('reviewer', 'qa-1');
const qa2 = who('reviewer', 'qa-2');
const o1 = who('operator', 'op-1');
const o2 = who('operator', 'op-2');

/** Two teams, a manager of the first, two QA, a top manager; three dialogs (two of team 1, one of team 2). */
function world() {
  const db = openDb(':memory:');
  const app = buildApp({ db });
  db.insert(teams).values([{ id: 't1', name: 'Группа 1', managerId: 'mgr-1' }, { id: 't2', name: 'Группа 2', managerId: null }]).run();
  db.insert(people).values([
    { id: 'lead-1', name: 'Топ', role: 'lead', teamId: null }, { id: 'mgr-1', name: 'Менеджер', role: 'manager', teamId: null },
    { id: 'qa-1', name: 'QA один', role: 'reviewer', teamId: null }, { id: 'qa-2', name: 'QA два', role: 'reviewer', teamId: null },
    { id: 'op-1', name: 'Оператор 1', role: 'operator', teamId: 't1' }, { id: 'op-2', name: 'Оператор 2', role: 'operator', teamId: 't2' },
  ]).run();
  const at = new Date().toISOString();
  for (const [id, op] of [['d1', 'op-1'], ['d2', 'op-1'], ['d3', 'op-2']] as const) {
    db.insert(conversations).values({ id, datasetGroupId: conv.datasetGroupId, language: conv.language, channel: conv.channel, audioUrl: null, transcript: conv.transcript, importedAt: at }).run();
    db.insert(operatorAssignments).values({ conversationId: id, operator: op, assignedBy: null, assignedAt: at }).run();
    insertEvaluation(db, { ...base, id: `e-${id}`, conversationId: id } as Evaluation);
  }
  return { app, db };
}
type App = ReturnType<typeof world>['app'];
const post = (app: App, url: string, headers: Record<string, string>, payload: object = {}) => app.inject({ method: 'POST', url, headers, payload });
const get = async (app: App, url: string, headers: Record<string, string>) => (await app.inject({ url, headers })).json();
const review = (app: App, id: string, headers: Record<string, string>, status = 'reviewed') => post(app, `/api/conversations/${id}/review`, headers, { status });

describe('least privilege: a manager sees only their team', () => {
  it('scopes dialogs, evaluations and appeals of a manager to the operators of the team they lead', async () => {
    const { app } = world();
    expect((await get(app, '/api/conversations', mgr)).map((c: { id: string }) => c.id)).toEqual(['d1', 'd2']);
    expect((await get(app, '/api/evaluations', mgr)).map((e: { conversationId: string }) => e.conversationId).sort()).toEqual(['d1', 'd2']);
    expect((await app.inject({ url: '/api/conversations/d3', headers: mgr })).statusCode).toBe(404);
    expect((await get(app, '/api/conversations', lead))).toHaveLength(3);
    expect((await get(app, '/api/conversations', o1)).map((c: { id: string }) => c.id)).toEqual(['d1', 'd2']);
    expect((await get(app, '/api/conversations', o2)).map((c: { id: string }) => c.id)).toEqual(['d3']);
    expect((await post(app, '/api/evaluations/e-d3/appeals', o2, { criterionId: '04', comment: 'x' })).statusCode).toBe(201);
    expect(await get(app, '/api/appeals', mgr)).toEqual([]); // team 2's appeal is not the manager's business
  });
});

describe('audit log', () => {
  it('records every human action with who, what and when, and only the audit roles read it', async () => {
    const { app } = world();
    await review(app, 'd1', qa1, 'in_review');
    await post(app, '/api/evaluations/e-d1/overrides', qa1, { criterionId: '04', reason: 'Согласен', value: 20 });
    await post(app, '/api/evaluations/e-d1/appeals', o1, { criterionId: '05', comment: 'Не согласен' });
    expect((await app.inject({ url: '/api/events', headers: qa1 })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/events', headers: mgr })).statusCode).toBe(403);
    const log = await get(app, '/api/events', lead);
    expect(log.map((e: { type: string }) => e.type)).toEqual(['appeal.filed', 'result.corrected', 'review.set']); // newest first
    expect(log.find((e: { type: string }) => e.type === 'result.corrected')).toMatchObject({ actorId: 'qa-1', actorRole: 'reviewer', conversationId: 'd1', data: { criterionId: '04', before: { value: 15 }, after: { value: 20 } } });
    expect((await get(app, '/api/events?type=review.set', lead))).toHaveLength(1);
  });
});

describe('critical notifications', () => {
  it('tell the manager of the operator\'s team and the top managers when a flag criterion is raised', async () => {
    const { app, db } = world();
    const flagged = { ...base, id: 'e-bad', conversationId: 'd2', seriousViolation: true, finalResults: base.finalResults.map((r) => (r.criterionId === '08' ? { ...r, value: true } : r)) } as Evaluation;
    insertEvaluation(db, flagged);
    const forMgr = await get(app, '/api/notifications', mgr);
    expect(forMgr).toHaveLength(1);
    expect(forMgr[0]).toMatchObject({ kind: 'critical', conversationId: 'd2' });
    expect(forMgr[0].body).toContain('Конфиденциальность'.slice(0, 0)); // names the raised flag criterion, not an id switch
    expect(await get(app, '/api/notifications', lead)).toHaveLength(1);
    expect(await get(app, '/api/notifications', qa1)).toEqual([]);
    expect(await get(app, '/api/notifications', o1)).toEqual([]);
    await post(app, '/api/notifications/read', mgr, {});
    expect((await get(app, '/api/notifications', mgr))[0].readAt).toBeTruthy();
  });
});

describe('coaching comments', () => {
  it('reach the operator, who acknowledges them; nobody else can, and a manager only comments on their team', async () => {
    const { app } = world();
    expect((await post(app, '/api/comments', o1, { conversationId: 'd1', body: 'x' })).statusCode).toBe(403);
    expect((await post(app, '/api/comments', mgr, { conversationId: 'd3', body: 'не моя группа' })).statusCode).toBe(404);
    const made = await post(app, '/api/comments', mgr, { conversationId: 'd1', criterionId: '04', body: 'Уточняйте детали' });
    expect(made.statusCode).toBe(201);
    const inbox = await get(app, '/api/notifications', o1);
    expect(inbox[0]).toMatchObject({ kind: 'comment', conversationId: 'd1' });
    expect((await get(app, '/api/comments', o2))).toEqual([]);
    expect((await post(app, `/api/comments/${made.json().id}/ack`, o2)).statusCode).toBe(403);
    const acked = await post(app, `/api/comments/${made.json().id}/ack`, o1);
    expect(acked.json().ackedAt).toBeTruthy();
  });
});

describe('tasks, cross-checks and QA-of-QA', () => {
  it('hands work to the QA person with the fewest open tasks, and a cross-check never goes to the first reviewer', async () => {
    const { app } = world();
    const t1 = (await post(app, '/api/tasks', lead, { conversationIds: ['d1'], kind: 'review' })).json();
    const t2 = (await post(app, '/api/tasks', lead, { conversationIds: ['d2'], kind: 'review' })).json();
    expect(t1[0]).toMatchObject({ assigneeId: 'qa-1', auto: true });
    expect(t2[0].assigneeId).toBe('qa-2'); // qa-1 already has one
    expect((await post(app, '/api/tasks', qa1, { conversationIds: ['d3'], kind: 'review' })).statusCode).toBe(403);
    expect((await get(app, '/api/tasks', qa1)).map((t: { id: string }) => t.id)).toEqual([t1[0].id]);
    expect(await get(app, '/api/tasks', lead)).toHaveLength(2);

    await review(app, 'd1', qa1); // finishing the check closes qa-1's review task
    expect((await get(app, '/api/tasks', qa1))[0].status).toBe('done');

    expect((await post(app, '/api/tasks', lead, { conversationIds: ['d3'], kind: 'crosscheck' })).statusCode).toBe(409); // not reviewed yet
    const cc = (await post(app, '/api/tasks', lead, { conversationIds: ['d1'], kind: 'crosscheck' })).json();
    expect(cc[0]).toMatchObject({ assigneeId: 'qa-2', firstReviewerId: 'qa-1' });
    expect((await post(app, '/api/tasks', lead, { conversationIds: ['d1'], kind: 'crosscheck', assigneeId: 'qa-1' })).json()).toEqual([]); // one open cross-check per dialog
  });

  it('a cross-check is a blind re-grade by someone else; the first reviewer cannot do it, QA only see their own, leads see all', async () => {
    const { app } = world();
    await review(app, 'd1', qa1);
    const [task] = (await post(app, '/api/tasks', lead, { conversationIds: ['d1'], kind: 'crosscheck' })).json();
    const results = base.finalResults.map((r) => ({ criterionId: r.criterionId, value: r.value, isNA: r.isNA }));
    expect((await post(app, '/api/crosschecks', qa1, { taskId: task.id, results })).statusCode).toBe(403);
    expect((await post(app, '/api/crosschecks', qa2, { taskId: task.id, results: [{ criterionId: '04', value: 999, isNA: false }] })).statusCode).toBe(400);
    const done = await post(app, '/api/crosschecks', qa2, { taskId: task.id, results });
    expect(done.statusCode).toBe(201);
    expect(done.json()).toMatchObject({ reviewerId: 'qa-2', conversationId: 'd1' });
    expect((await post(app, '/api/crosschecks', qa2, { taskId: task.id, results })).statusCode).toBe(409);
    expect(await get(app, '/api/crosschecks', qa1)).toEqual([]);
    expect(await get(app, '/api/crosschecks', qa2)).toHaveLength(1);
    expect(await get(app, '/api/crosschecks', lead)).toHaveLength(1);
  });

  it('a top manager can audit the QA team: the same mechanism, assigned to themselves', async () => {
    const { app } = world();
    await review(app, 'd1', qa1);
    const [task] = (await post(app, '/api/tasks', lead, { conversationIds: ['d1'], kind: 'crosscheck', assigneeId: 'lead-1' })).json();
    const results = base.finalResults.map((r) => ({ criterionId: r.criterionId, value: r.value, isNA: r.isNA }));
    expect((await post(app, '/api/crosschecks', lead, { taskId: task.id, results })).json()).toMatchObject({ reviewerRole: 'lead', reviewerId: 'lead-1' });
  });

  it('samples a percentage of reviewed dialogs for a second check', async () => {
    const { app } = world();
    await review(app, 'd1', qa1);
    await review(app, 'd2', qa1);
    const tasks = (await post(app, '/api/tasks/sample', lead, { percent: 100 })).json();
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t: { assigneeId: string }) => t.assigneeId === 'qa-2')).toBe(true);
    expect((await post(app, '/api/tasks/sample', lead, { percent: 100 })).json()).toEqual([]); // never twice
  });
});

describe('tags, taxonomy and timeline', () => {
  it('tags carry an origin and never change a grade; categories and timeline belong to the top managers', async () => {
    const { app } = world();
    expect((await post(app, '/api/taxonomy', qa1, { label: 'Неполный ответ' })).statusCode).toBe(403);
    expect((await post(app, '/api/taxonomy', lead, { label: 'Неполный ответ', criterionId: '04' })).statusCode).toBe(201);
    expect((await post(app, '/api/taxonomy', lead, { label: 'Неполный ответ', criterionId: '04' })).statusCode).toBe(409);
    const before = (await get(app, '/api/evaluations/e-d1', lead)).finalTotal;
    expect((await post(app, '/api/tags', qa1, { evaluationId: 'e-d1', criterionId: '04', origin: 'rule', label: 'Неполный ответ' })).statusCode).toBe(201);
    expect((await post(app, '/api/tags', o1, { evaluationId: 'e-d1', origin: 'operator' })).statusCode).toBe(403);
    expect((await get(app, '/api/evaluations/e-d1', lead)).finalTotal).toBe(before);
    expect(await get(app, '/api/tags', lead)).toHaveLength(1);
    expect(await get(app, '/api/tags', mgr)).toHaveLength(1); // team 1's
    expect(await get(app, '/api/tags', o2)).toEqual([]);

    const ev = { date: '2026-11-01', title: 'Тренинг по верификации', kind: 'training', participantIds: ['op-1'], comparisonIds: ['op-2'] };
    expect((await post(app, '/api/timeline', qa1, ev)).statusCode).toBe(403);
    expect((await post(app, '/api/timeline', lead, { ...ev, date: 'вчера' })).statusCode).toBe(400);
    expect((await post(app, '/api/timeline', lead, ev)).statusCode).toBe(201);
    expect(await get(app, '/api/timeline', mgr)).toHaveLength(1);
  });
});

describe('directory', () => {
  it('lets only the lead/admin manage people and builds a fictional demo organisation once, into an empty directory', async () => {
    const db = openDb(':memory:');
    const app = buildApp({ db });
    const admin = who('admin', 'admin-1');
    db.insert(conversations).values({ id: 'x1', datasetGroupId: 'g', language: 'RU', channel: 'agent chat', audioUrl: null, transcript: conv.transcript, importedAt: new Date().toISOString() }).run();
    expect((await post(app, '/api/people', qa1, { id: 'p', name: 'Н', role: 'operator', teamId: null })).statusCode).toBe(403);
    const seeded = await post(app, '/api/demo/org', admin);
    expect(seeded.statusCode).toBe(201);
    expect(seeded.json().assigned).toBe(1);
    expect((await post(app, '/api/demo/org', admin)).statusCode).toBe(409);
    const d = await get(app, '/api/directory', admin);
    expect(d.people.filter((p: { role: string }) => p.role === 'operator')).toHaveLength(8);
    expect(d.teams).toHaveLength(2);
    expect((await get(app, '/api/conversations', admin))[0].operatorId).toMatch(/^op-/);
  });
});
