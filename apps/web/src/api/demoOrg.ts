import { scoreEvaluation, type Appeal, type AuditEvent, type ChecklistVersion, type Comment, type Conversation, type Crosscheck, type Criterion, type CriterionResult, type DemoBundle, type Directory, type Evaluation, type Notification, type Tag, type Task, type TaxonomyItem, type TimelineEvent } from '@cqa/contracts';
import type { OrgSeed } from './MockCqaApi';

/**
 * Mock-only organisation around the fictional dialogs: two teams, QA, managers, ten weeks of evaluated dialogs, a
 * training with a comparison group, reviews, comments, tags, cross-checks and an audit trail. Everything is invented
 * (deterministic, seeded) so the team and analytics screens have something to show offline; the DEV data has none of
 * it. Results are drawn from each criterion's own configuration, never from its id, and totals come from the shared scorer.
 */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['Алина Ким', 'Тимур Сарсенов', 'Дана Ахметова', 'Марат Исаев', 'Аружан Оспанова', 'Ерлан Волков', 'Камила Ли', 'Нурлан Байжанов'];
export const DEMO_DIRECTORY: Directory = {
  teams: [{ id: 'team-a', name: 'Группа А', managerId: 'mgr-a' }, { id: 'team-b', name: 'Группа Б', managerId: 'mgr-b' }],
  people: [
    { id: 'mgr-a', name: 'Асель Нурпеисова', role: 'manager', teamId: null },
    { id: 'mgr-b', name: 'Виктор Лим', role: 'manager', teamId: null },
    { id: 'lead-1', name: 'Игорь Касымов', role: 'lead', teamId: null },
    { id: 'admin-1', name: 'Админ Системы', role: 'admin', teamId: null },
    ...['Мария Левина', 'Сергей Аубакиров', 'Ольга Темирова', 'Булат Ержанов'].map((name, i) => ({ id: `qa-${i + 1}`, name, role: 'reviewer' as const, teamId: null })),
    ...NAMES.map((name, i) => ({ id: `op-${i + 1}`, name, role: 'operator' as const, teamId: i % 2 === 0 ? 'team-a' : 'team-b' })),
  ],
};

const day = (iso: string, plus = 0) => new Date(Date.parse(iso) + plus * 86_400_000).toISOString();
const START = '2026-09-28T09:00:00.000Z';
const TRAINING = '2026-10-19';

/** A value for one criterion: better with higher `skill`, by the criterion's configuration only. */
function pick(c: Criterion, skill: number, r: () => number, crit: number): CriterionResult {
  const base = { criterionId: c.id, isNA: false, explanation: 'MOCK: сгенерировано из настроек критерия, не из текста диалога.', evidence: [], source: 'model' as const, confidence: 'high' as const };
  if (c.criticalFlag) return { ...base, value: r() < crit };
  if (c.kind === 'boolean') return { ...base, value: r() < skill };
  if (c.kind === 'discrete-scale') {
    const tiers = [...(c.allowedValues as number[])].sort((a, b) => a - b);
    const i = Math.min(tiers.length - 1, Math.max(0, Math.round(skill * (tiers.length - 1) + (r() - 0.5) * 1.6)));
    return { ...base, value: tiers[i]! };
  }
  return { ...base, value: c.allowedValues[Math.floor(r() * c.allowedValues.length)]! };
}

export function richOrg(bundle: DemoBundle, seedAppeals: Appeal[]): { bundle: DemoBundle; org: OrgSeed; appeals: Appeal[] } {
  const r = rng(20261108);
  const checklist: ChecklistVersion = bundle.checklists[0]!;
  const scored = checklist.criteria.filter((c) => !c.criticalFlag && c.weight > 0);
  /** The criterion reviewers disagree with most: the "unclear rule" the analytics should point at. */
  const unclear = scored[Math.min(3, scored.length - 1)]!;
  const operators = DEMO_DIRECTORY.people.filter((p) => p.role === 'operator');
  const skill = new Map(operators.map((p, i) => [p.id, 0.55 + 0.04 * ((i * 3) % 7)]));
  const trained = new Set(['op-1', 'op-3', 'op-5', 'op-7']);
  const qa = ['qa-1', 'qa-2', 'qa-3', 'qa-4'];
  const qaName = (id: string) => DEMO_DIRECTORY.people.find((p) => p.id === id)!.name;

  const conversations: Conversation[] = [];
  const evaluations: Evaluation[] = [];
  const events: AuditEvent[] = [];
  const comments: Comment[] = [];
  const tags: Tag[] = [];
  const tasks: Task[] = [];
  const crosschecks: Crosscheck[] = [];
  const notifications: Notification[] = [];
  const appeals: Appeal[] = [...seedAppeals];
  const ev = (at: string, actor: string, role: AuditEvent['actorRole'], type: AuditEvent['type'], summary: string, conversationId?: string, data?: Record<string, unknown>) =>
    events.push({ id: `ev-demo-${events.length + 1}`, at, actorId: actor, actorName: DEMO_DIRECTORY.people.find((p) => p.id === actor)?.name ?? actor, actorRole: role, type, summary, ...(conversationId ? { conversationId } : {}), ...(data ? { data } : {}) });

  let k = 0;
  for (const op of operators) {
    for (let i = 0; i < 9; i++, k++) {
      const id = `demo-gen-${String(k + 1).padStart(3, '0')}`;
      const at = day(START, Math.floor((i / 9) * 40) + Math.floor(r() * 3));
      const after = at.slice(0, 10) >= TRAINING;
      const s = Math.min(0.95, skill.get(op.id)! + (after && trained.has(op.id) ? 0.2 : 0) + (after ? 0.02 : 0));
      const results = checklist.criteria.map((c) => pick(c, s, r, 0.04));
      const { total, seriousViolation } = scored.length ? scoreEvaluation(checklist, results) : { total: 0, seriousViolation: false };
      const csat = r() < 0.6 ? Math.max(1, Math.min(5, Math.round(1 + ((total ?? 0) / 100) * 4 + (r() - 0.5) * 2))) : null;
      const reuse = i > 0 && r() < 0.18;
      const prev = conversations[conversations.length - 1];
      conversations.push({
        id, datasetGroupId: 'demo-fictional', language: r() < 0.7 ? 'RU' : 'KZ', channel: 'agent chat', audioUrl: null,
        transcript: [
          { index: 0, timestamp: '00:00', speaker: 'client', text: `Фиктивный вопрос клиента №${k + 1}.` },
          { index: 1, timestamp: '00:20', speaker: 'operator', text: 'Фиктивный ответ оператора.' },
          { index: 2, timestamp: '00:45', speaker: 'client', text: 'Спасибо.' },
        ],
        importedAt: day(at, 0), startedAt: day(at, -1), operatorId: op.id,
        clientId: reuse && prev?.operatorId === op.id ? prev.clientId ?? null : `client-${(k * 7) % 61}`,
        csat,
      });
      const finalResults = structuredClone(results);
      const changed = r() < 0.34 || (r() < 0.05);
      const target = finalResults.find((x) => x.criterionId === unclear.id)!;
      if (changed && typeof target.value === 'number') target.value = [...(unclear.allowedValues as number[])].sort((a, b) => b - a)[Math.floor(r() * 2)]!;
      const final = scored.length ? scoreEvaluation(checklist, finalResults) : { total, seriousViolation };
      evaluations.push({ id: `eval-${id}`, conversationId: id, checklistVersionId: checklist.id, status: 'completed', originalResults: results, originalTotal: total, finalResults, finalTotal: final.total, seriousViolation: final.seriousViolation, createdAt: at, provenance: { provider: 'mock', model: 'placeholder', promptVersion: 'n/a' } });
      void seriousViolation;
    }
  }

  // Reviews, corrections, comments, tags, tasks and the audit trail around them.
  const rootCrit = scored.map((c) => c.id);
  conversations.forEach((c, i) => {
    const e = evaluations[i]!;
    const reviewer = qa[i % qa.length]!;
    const t0 = Date.parse(e.createdAt!) + (1 + (i % 5)) * 3_600_000;
    const state = r();
    const wasChanged = e.finalResults.some((x, j) => x.value !== e.originalResults[j]!.value);
    if (state < 0.55) {
      const minutes = 3 + Math.floor(r() * 10);
      const taken = new Date(t0).toISOString();
      const done = new Date(t0 + minutes * 60_000).toISOString();
      ev(taken, reviewer, 'reviewer', 'review.set', 'Диалог взят в работу', c.id, { status: 'in_review', evaluationId: e.id });
      if (wasChanged) {
        const j = e.finalResults.findIndex((x, n) => x.value !== e.originalResults[n]!.value);
        ev(new Date(t0 + 60_000 * 2).toISOString(), reviewer, 'reviewer', 'result.corrected', `Исправлена оценка критерия ${e.finalResults[j]!.criterionId}`, c.id, { criterionId: e.finalResults[j]!.criterionId, before: { value: e.originalResults[j]!.value }, after: { value: e.finalResults[j]!.value }, evaluationId: e.id });
      }
      ev(done, reviewer, 'reviewer', 'review.set', 'Диалог отмечен проверенным', c.id, { status: 'reviewed', evaluationId: e.id });
      c.review = { status: 'reviewed', evaluationId: e.id, by: qaName(reviewer), at: done };
    } else if (state < 0.7) {
      c.review = { status: 'in_review', evaluationId: e.id, by: qaName(reviewer), at: new Date(t0).toISOString() };
      ev(new Date(t0).toISOString(), reviewer, 'reviewer', 'review.set', 'Диалог взят в работу', c.id, { status: 'in_review', evaluationId: e.id });
    }
    if (e.seriousViolation) {
      const mgr = DEMO_DIRECTORY.teams.find((t) => t.id === DEMO_DIRECTORY.people.find((p) => p.id === c.operatorId)?.teamId)!.managerId!;
      notifications.push({ id: `n-demo-${notifications.length + 1}`, at: e.createdAt!, recipientId: mgr, kind: 'critical', title: `Грубое нарушение: ${c.id}`, body: 'Выявлено грубое нарушение.', conversationId: c.id });
      if (c.review?.status === 'reviewed' && r() < 0.7) comments.push({ id: `c-demo-${comments.length + 1}`, conversationId: c.id, authorId: mgr, authorName: DEMO_DIRECTORY.people.find((p) => p.id === mgr)!.name, body: 'Разберём на ближайшей планёрке: прошу повторить правило.', createdAt: day(e.createdAt!, 1), ...(r() < 0.5 ? { ackedAt: day(e.createdAt!, 2) } : {}) });
    }
    const lost = e.finalResults.find((x, j) => scored.some((s2) => s2.id === x.criterionId) && typeof x.value === 'number' && x.value < Math.max(...(scored.find((s2) => s2.id === x.criterionId)!.allowedValues as number[])) && j >= 0);
    if (lost && c.review?.status === 'reviewed' && r() < 0.6) {
      const origin = lost.criterionId === unclear.id && r() < 0.6 ? 'rule' : r() < 0.2 ? 'process' : r() < 0.1 ? 'tool' : 'operator';
      tags.push({ id: `tag-demo-${tags.length + 1}`, evaluationId: e.id, conversationId: c.id, criterionId: lost.criterionId, origin, label: origin === 'operator' ? ['Неполный ответ', 'Не уточнил вопрос', 'Тон общения'][i % 3]! : origin === 'rule' ? 'Правило сформулировано неясно' : origin === 'process' ? 'Нет данных в системе' : 'Сбой инструмента', by: qaName(reviewer), at: c.review.at });
      ev(c.review.at, reviewer, 'reviewer', 'tag.added', `Причина ошибки: ${origin}`, c.id, { criterionId: lost.criterionId, origin });
    }
  });
  // Appeals on the unclear criterion, mostly upheld for the operator: a signal for the rule, not the people.
  conversations.filter((c) => c.review?.status === 'reviewed').slice(0, 9).forEach((c, i) => {
    const e = evaluations.find((x) => x.conversationId === c.id)!;
    const over = i % 3 !== 0;
    appeals.push({ id: `appeal-gen-${i + 1}`, evaluationId: e.id, criterionId: unclear.id, kind: 'appeal', comment: 'Формулировка критерия допускает такое прочтение.', status: over ? 'overridden' : 'upheld', createdAt: day(e.createdAt!, 1), createdBy: DEMO_DIRECTORY.people.find((p) => p.id === c.operatorId)?.name, decidedAt: day(e.createdAt!, 2), decidedBy: qaName(qa[i % 4]!), reviewerReason: over ? 'Согласен: критерий неясен.' : 'Оценка верна.' });
    ev(day(e.createdAt!, 1), c.operatorId!, 'operator', 'appeal.filed', `Апелляция по критерию ${unclear.id}`, c.id, { criterionId: unclear.id });
  });
  // A few cross-checks (peer and top-manager audit) and open tasks.
  const reviewed = conversations.filter((c) => c.review?.status === 'reviewed');
  reviewed.slice(0, 8).forEach((c, i) => {
    const e = evaluations.find((x) => x.conversationId === c.id)!;
    const first = DEMO_DIRECTORY.people.find((p) => p.name === c.review!.by)!.id;
    const checker = i % 4 === 3 ? 'lead-1' : qa.find((q) => q !== first)!;
    const results = e.finalResults.map((x) => ({ criterionId: x.criterionId, value: x.value, isNA: x.isNA })).map((x, j) => (j === 2 && i % 2 === 0 && typeof x.value === 'number' ? { ...x, value: Math.max(0, x.value - 5) } : x));
    tasks.push({ id: `task-demo-${tasks.length + 1}`, conversationId: c.id, assigneeId: checker, kind: 'crosscheck', status: 'done', auto: checker !== 'lead-1', createdBy: 'Игорь Касымов', createdAt: day(e.createdAt!, 3), doneAt: day(e.createdAt!, 4), firstReviewerId: first });
    crosschecks.push({ id: `cc-demo-${i + 1}`, taskId: `task-demo-${tasks.length}`, conversationId: c.id, evaluationId: e.id, reviewerId: checker, reviewerName: qaName(checker) ?? 'Игорь Касымов', reviewerRole: checker === 'lead-1' ? 'lead' : 'reviewer', results, submittedAt: day(e.createdAt!, 4) });
    ev(day(e.createdAt!, 4), checker, checker === 'lead-1' ? 'lead' : 'reviewer', 'crosscheck.submitted', 'Контрольная проверка выполнена', c.id, { evaluationId: e.id });
  });
  conversations.filter((c) => !c.review).slice(0, 6).forEach((c, i) => tasks.push({ id: `task-demo-${tasks.length + 1}`, conversationId: c.id, assigneeId: qa[i % 4]!, kind: 'review', status: 'open', auto: true, createdBy: 'Игорь Касымов', createdAt: day('2026-11-06T09:00:00.000Z'), }));

  // A burst of reviews: what the suspicious-activity monitor is for.
  const burst = conversations.filter((c) => !c.review).slice(6, 11);
  burst.forEach((c, i) => {
    const e = evaluations.find((x) => x.conversationId === c.id)!;
    const at = new Date(Date.parse('2026-11-07T15:00:00.000Z') + i * 15_000).toISOString();
    ev(at, 'qa-4', 'reviewer', 'review.set', 'Диалог отмечен проверенным', c.id, { status: 'reviewed', evaluationId: e.id });
    c.review = { status: 'reviewed', evaluationId: e.id, by: qaName('qa-4'), at };
  });

  const timeline: TimelineEvent[] = [
    { id: 'tl-demo-1', date: TRAINING, title: 'Тренинг по работе с возражениями', kind: 'training', note: 'Для группы А; группа Б — сравнительная.', participantIds: [...trained], comparisonIds: operators.filter((o) => !trained.has(o.id)).map((o) => o.id), createdBy: 'Игорь Касымов', createdAt: '2026-10-12T09:00:00.000Z' },
    { id: 'tl-demo-2', date: '2026-10-26', title: 'Новая редакция правила идентификации', kind: 'policy', participantIds: [], comparisonIds: [], createdBy: 'Игорь Касымов', createdAt: '2026-10-25T09:00:00.000Z' },
  ];
  const taxonomy: TaxonomyItem[] = ['Неполный ответ', 'Не уточнил вопрос', 'Тон общения'].map((label, i) => ({ id: `tx-demo-${i + 1}`, label, criterionId: i === 2 ? undefined : unclear.id })).map((t) => (t.criterionId ? t : { id: t.id, label: t.label }));
  void rootCrit;

  const ordered = events.sort((a, b) => b.at.localeCompare(a.at));
  // The existing fictional dialogs keep their own evaluations; they belong to the first operators.
  const base = bundle.conversations.map((c, i) => ({ ...c, operatorId: c.operatorId ?? `op-${(i % 4) + 1}` }));
  return {
    bundle: { conversations: [...base, ...conversations], checklists: bundle.checklists, evaluations: [...bundle.evaluations, ...evaluations] },
    org: { directory: DEMO_DIRECTORY, comments, tags, tasks, crosschecks, events: ordered, timeline, taxonomy, notifications },
    appeals,
  };
}
