import type { Appeal, AuditEvent, ChecklistVersion, Comment, Conversation, Crosscheck, CriterionResult, Directory, Evaluation, TimelineEvent } from '@cqa/contracts';
import { describe, expect, it } from 'vitest';
import { agreement, criterionSignals, csatStats, errorStats, fcr, followUp, qaMetrics, rankOperators, suspicious, trainingEffect, weeklyTrend, weekStart, type Ctx } from '../src/lib/analytics';

const msg = [{ index: 0, timestamp: '00:00', speaker: 'client' as const, text: 'x' }];
const conv = (id: string, operatorId: string | null, extra: Partial<Conversation> = {}): Conversation => ({ id, datasetGroupId: 'g', language: 'RU', channel: 'agent chat', transcript: msg, audioUrl: null, operatorId, ...extra });
const checklist: ChecklistVersion = {
  id: 'c1', version: 1, title: 'T', createdAt: '2026-11-01T00:00:00Z',
  criteria: [
    { id: 'a', title: 'Alpha', instructions: '', weight: 10, kind: 'discrete-scale', allowedValues: [0, 5, 10], allowNA: false },
    { id: 'f', title: 'Flag', instructions: '', weight: 0, kind: 'boolean', allowedValues: [true, false], allowNA: false, criticalFlag: true },
  ],
};
const res = (criterionId: string, value: CriterionResult['value']): CriterionResult => ({ criterionId, value, isNA: false, explanation: '', evidence: [] });
const ev = (conversationId: string, total: number, createdAt: string, extra: Partial<Evaluation> = {}): Evaluation => ({
  id: `e-${conversationId}`, conversationId, checklistVersionId: 'c1', status: 'completed', originalResults: [res('a', 10), res('f', false)], originalTotal: total, finalResults: [res('a', 10), res('f', false)], finalTotal: total, seriousViolation: false, createdAt, ...extra,
});
const directory: Directory = {
  teams: [{ id: 't1', name: 'Группа 1', managerId: null }],
  people: [{ id: 'o1', name: 'Анна', role: 'operator', teamId: 't1' }, { id: 'o2', name: 'Борис', role: 'operator', teamId: 't1' }, { id: 'o3', name: 'Вера', role: 'operator', teamId: 't1' }],
};
const ctx = (conversations: Conversation[], evaluations: Evaluation[], appeals: Appeal[] = []): Ctx => ({ conversations, evaluations, appeals, checklists: [checklist], directory });
const many = (op: string, n: number, score: number, date: string, prefix = op) => Array.from({ length: n }, (_, i) => ({ c: conv(`${prefix}-${i}`, op), e: ev(`${prefix}-${i}`, score, date) }));

describe('rankOperators', () => {
  it('ranks by average, and lists but does not rank people with fewer than the minimum number of dialogs', () => {
    const rows = [...many('o1', 5, 90, '2026-11-02T10:00:00Z'), ...many('o2', 5, 70, '2026-11-02T10:00:00Z'), ...many('o3', 2, 100, '2026-11-02T10:00:00Z')];
    const r = rankOperators(ctx(rows.map((x) => x.c), rows.map((x) => x.e)));
    expect(r.map((x) => [x.name, x.rank, x.n])).toEqual([['Анна', 1, 5], ['Борис', 2, 5], ['Вера', null, 2]]);
    expect(r[2]!.average).toBe(100); // shown, never ranked: two dialogs rank noise
  });
});

describe('weeklyTrend', () => {
  it('groups the current evaluation of each dialog by week and can be limited to some operators', () => {
    expect(weekStart('2026-11-08T12:00:00Z')).toBe('2026-11-02'); // a Sunday belongs to the week of the Monday before
    const rows = [...many('o1', 2, 80, '2026-11-02T10:00:00Z'), ...many('o1', 2, 90, '2026-11-10T10:00:00Z', 'late'), ...many('o2', 1, 10, '2026-11-02T10:00:00Z')];
    const c = ctx(rows.map((x) => x.c), rows.map((x) => x.e));
    expect(weeklyTrend(c, new Set(['o1']))).toEqual([{ week: '2026-11-02', n: 2, average: 80 }, { week: '2026-11-09', n: 2, average: 90 }]);
    expect(weeklyTrend(c)[0]).toMatchObject({ n: 3 });
  });
});

describe('trainingEffect', () => {
  const event: TimelineEvent = { id: 't', date: '2026-11-10', title: 'Тренинг', kind: 'training', participantIds: ['o1'], comparisonIds: ['o2'], createdBy: 'x', createdAt: '2026-11-01T00:00:00Z' };
  const rows = [
    ...many('o1', 5, 60, '2026-11-03T00:00:00Z', 'p-b'), ...many('o1', 5, 80, '2026-11-12T00:00:00Z', 'p-a'),
    ...many('o2', 5, 62, '2026-11-03T00:00:00Z', 'c-b'), ...many('o2', 5, 66, '2026-11-12T00:00:00Z', 'c-a'),
  ];
  it('measures the trained group against a comparison group that was not trained (difference in differences)', () => {
    const t = trainingEffect(event, ctx(rows.map((x) => x.c), rows.map((x) => x.e)));
    expect(t.participantChange).toBe(20);
    expect(t.effect).toBe(16); // +20 for the trained, +4 for everyone else: the training is worth 16
    expect(t.enough).toBe(true);
  });
  it('says nothing when a cell has too few dialogs, and without a comparison it does not claim an effect', () => {
    const few = rows.filter((x) => !x.c.id.startsWith('c-a'));
    const t = trainingEffect(event, ctx(few.map((x) => x.c), few.map((x) => x.e)));
    expect(t.effect).toBeNull();
    expect(t.participantChange).toBe(20);
    expect(t.enough).toBe(false);
    expect(trainingEffect(event, ctx(rows.map((x) => x.c), rows.map((x) => x.e)), 6).participantChange).toBeNull();
  });
});

describe('criterionSignals', () => {
  it('flags a criterion that reviewers keep changing or whose appeals keep being upheld as possibly unclear', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ c: conv(`d${i}`, 'o1'), e: ev(`d${i}`, 80, '2026-11-02T00:00:00Z', i < 3 ? { finalResults: [res('a', 5), res('f', false)] } : {}) }));
    const appeals: Appeal[] = [{ id: 'p', evaluationId: 'e-d5', criterionId: 'a', kind: 'appeal', comment: '', status: 'overridden', createdAt: '2026-11-03T00:00:00Z' }];
    const s = criterionSignals(ctx(rows.map((x) => x.c), rows.map((x) => x.e), appeals));
    expect(s[0]).toMatchObject({ criterionId: 'a', title: 'Alpha', n: 10, changed: 3, overturned: 1, suspectUnclear: true });
    expect(s.find((x) => x.criterionId === 'f')).toMatchObject({ changed: 0, suspectUnclear: false });
    expect(criterionSignals(ctx(rows.slice(0, 4).map((x) => x.c), rows.slice(0, 4).map((x) => x.e)))[0]!.suspectUnclear).toBe(false); // too few results to point a finger
  });
});

describe('errorStats', () => {
  it('counts causes by origin and shows how much is not the operator\'s doing', () => {
    const tag = (origin: 'operator' | 'process' | 'rule' | 'tool', label?: string, criterionId?: string) => ({ id: Math.random().toString(), evaluationId: 'e', conversationId: 'c', origin, label, criterionId, by: 'x', at: 'now' });
    const s = errorStats([tag('operator', 'Неполный ответ', 'a'), tag('rule', 'Неполный ответ', 'a'), tag('process'), tag('operator', 'Тон')]);
    expect(s.byOrigin).toEqual({ operator: 2, process: 1, rule: 1, tool: 0 });
    expect(s.notOperatorShare).toBe(0.5);
    expect(s.byLabel[0]).toEqual({ label: 'Неполный ответ', count: 2 });
    expect(errorStats([]).notOperatorShare).toBeNull();
  });
});

describe('qaMetrics', () => {
  const e = (at: string, actor: string, conversationId: string, status: string): AuditEvent => ({ id: `${at}${conversationId}`, at, actorId: actor, actorName: actor, type: 'review.set', conversationId, summary: '', data: { status } });
  it('times a review from "in review" to "reviewed" by the same person, and measures the queue from the dialogs still open', () => {
    const events = [e('2026-11-08T10:00:00Z', 'qa1', 'd1', 'in_review'), e('2026-11-08T10:10:00Z', 'qa1', 'd1', 'reviewed'), e('2026-11-08T11:00:00Z', 'qa1', 'd2', 'reviewed')];
    const cs = [conv('d1', 'o1'), conv('d2', 'o1'), conv('d3', 'o1', { importedAt: '2026-11-06T00:00:00Z' })];
    const evs = [ev('d1', 90, '2026-11-05T00:00:00Z'), ev('d2', 90, '2026-11-05T00:00:00Z'), ev('d3', 90, '2026-11-06T00:00:00Z')];
    const now = Date.parse('2026-11-08T12:00:00Z');
    const m = qaMetrics(events, [{ id: 't', conversationId: 'd3', assigneeId: 'o1', kind: 'review', status: 'open', auto: true, createdBy: 'x', createdAt: 'x' }], cs, evs, directory, now);
    expect(m.rows[0]).toMatchObject({ reviewer: 'qa1', reviewed: 2, timed: 1, medianMinutes: 10 }); // d2 was never taken first: no duration
    expect(m.queueLength).toBe(3); // nothing is marked on the dialogs themselves here, so all three are open
    expect(m.backlogAgeDays).toBeCloseTo(3.5, 1);
    expect(m.reviewedLast7Days).toBe(2);
    expect(m.rows.find((r) => r.reviewer === 'Анна')?.openTasks).toBe(1);
  });
});

describe('agreement', () => {
  it('compares a cross-check with the result after the first review and with the AI\'s original answer', () => {
    const e = ev('d1', 80, '2026-11-02T00:00:00Z', { finalResults: [res('a', 5), res('f', false)] }); // the first reviewer changed 'a' from 10 to 5
    const cc = (name: string, role: string, a: number): Crosscheck => ({ id: name, taskId: 't', conversationId: 'd1', evaluationId: e.id, reviewerName: name, reviewerRole: role, results: [{ criterionId: 'a', value: a, isNA: false }, { criterionId: 'f', value: false, isNA: false }], submittedAt: 'now' });
    const r = agreement([cc('qa2', 'reviewer', 5), cc('top', 'lead', 10)], [e]);
    expect(r.rows.find((x) => x.reviewer === 'qa2')).toMatchObject({ results: 2, agreeFirst: 2, agreeAi: 1 });
    expect(r.rows.find((x) => x.reviewer === 'top')).toMatchObject({ role: 'lead', agreeFirst: 1, agreeAi: 2 });
    expect(r.byCriterion[0]).toMatchObject({ criterionId: 'a', results: 2, agreeFirst: 1 });
  });
});

describe('suspicious', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 10, 8, 10, 0, s)).toISOString();
  const ev1 = (type: AuditEvent['type'], s: number, actor: string, conversationId: string, data: Record<string, unknown>): AuditEvent => ({ id: `${type}${s}${conversationId}`, at: at(s), actorId: actor, actorName: actor, type, conversationId, summary: '', data });
  it('flags a burst of reviews, corrections that all go one way, and a person deciding an appeal on their own correction', () => {
    const burst = [0, 10, 20, 30, 40].map((s) => ev1('review.set', s, 'qa1', `d${s}`, { status: 'reviewed' }));
    const slow = [0, 100, 200, 300, 400].map((s) => ev1('review.set', s, 'qa2', `s${s}`, { status: 'reviewed' }));
    const ups = [1, 2, 3, 4, 5].map((i) => ev1('result.corrected', 100 + i, 'qa3', `u${i}`, { before: { value: 5 }, after: { value: 10 } }));
    const mixed = [1, 2, 3, 4, 5].map((i) => ev1('result.corrected', 100 + i, 'qa4', `m${i}`, { before: { value: 5 }, after: { value: i % 2 ? 10 : 0 } }));
    const own = [ev1('result.corrected', 200, 'qa5', 'x', { before: { value: 5 }, after: { value: 10 } }), ev1('appeal.decided', 300, 'qa5', 'x', { action: 'uphold' })];
    const kinds = suspicious([...burst, ...slow, ...ups, ...mixed, ...own]).map((f) => `${f.kind}:${f.actor}`).sort();
    expect(kinds).toEqual(['one-direction:qa3', 'rubber-stamp:qa1', 'self-review:qa5']);
  });
});

describe('followUp', () => {
  it('tracks a serious violation from "nobody looked" to "reviewed, commented and read"', () => {
    const bad = (id: string) => ev(id, 40, '2026-11-02T00:00:00Z', { seriousViolation: true });
    const reviewed = (id: string): Partial<Conversation> => ({ review: { status: 'reviewed', evaluationId: `e-${id}`, by: 'x', at: 'now' } });
    const cs = [conv('a', 'o1'), conv('b', 'o1', reviewed('b')), conv('c', 'o1', reviewed('c')), conv('d', 'o1', reviewed('d')), conv('ok', 'o1')];
    const evs = [bad('a'), bad('b'), bad('c'), bad('d'), ev('ok', 90, '2026-11-02T00:00:00Z')];
    const comment = (conversationId: string, ackedAt?: string): Comment => ({ id: conversationId, conversationId, authorName: 'x', body: 'b', createdAt: 'now', ...(ackedAt ? { ackedAt } : {}) });
    const f = followUp(cs, evs, [comment('c'), comment('d', 'now')]);
    expect(Object.fromEntries(f.map((x) => [x.conversationId, x.stage]))).toEqual({ a: 'unreviewed', b: 'no_comment', c: 'unacknowledged', d: 'done' });
  });
});

describe('clients: repeat contacts and ratings', () => {
  it('reports repeat contacts only when the data has client ids and dates, never a guess', () => {
    expect(fcr([conv('a', 'o1')])).toBeNull();
    const c = [conv('a', 'o1', { clientId: 'k1', startedAt: '2026-11-01T10:00:00Z' }), conv('b', 'o1', { clientId: 'k1', startedAt: '2026-11-03T10:00:00Z' }), conv('c', 'o1', { clientId: 'k2', startedAt: '2026-11-01T10:00:00Z' }), conv('d', 'o1', { clientId: 'k1', startedAt: '2026-11-20T10:00:00Z' })];
    expect(fcr(c)).toMatchObject({ clients: 2, contacts: 4, repeated: 1, rate: 0.75 });
  });

  it('relates the client\'s rating to the score and shows which criteria separate happy from unhappy clients', () => {
    const rows = [
      { c: conv('l1', 'o1', { csat: 1 }), e: ev('l1', 40, '2026-11-02T00:00:00Z', { finalResults: [res('a', 0), res('f', false)] }) },
      { c: conv('l2', 'o1', { csat: 2 }), e: ev('l2', 50, '2026-11-02T00:00:00Z', { finalResults: [res('a', 5), res('f', false)] }) },
      { c: conv('h1', 'o1', { csat: 5 }), e: ev('h1', 95, '2026-11-02T00:00:00Z') },
      { c: conv('h2', 'o1', { csat: 4 }), e: ev('h2', 90, '2026-11-02T00:00:00Z') },
    ];
    const s = csatStats(rows.map((x) => x.c), rows.map((x) => x.e), [checklist])!;
    expect(s.n).toBe(4);
    expect(s.correlation).toBeGreaterThan(0.9);
    expect(s.criteria[0]).toMatchObject({ criterionId: 'a', low: 0.25, high: 1, gap: 0.75 });
    expect(csatStats([conv('x', 'o1')], [], [checklist])).toBeNull();
  });
});
