import { evaluationMaps } from '@cqa/contracts';
import type { Appeal, ChecklistVersion, Conversation, Criterion, Evaluation, Language } from '@cqa/contracts';
import { earnedPoints, needsReview, sameResult } from './present';
import { reviewOf } from './queue';

/**
 * Aggregates for the overview page, computed from what the app already loaded (no endpoint, no contract change).
 * Everything is derived from the checklist's own criteria: nothing switches on a criterion id, so a criterion added
 * in the editor shows up here as soon as a dialog is evaluated with it.
 */

export type CriterionStat = {
  criterion: Criterion;
  /** Evaluations that include this criterion. */
  total: number;
  /** Points criteria: full marks, some points, nothing earned. */
  full: number;
  partial: number;
  zero: number;
  /** Flag criteria (serious violation): how often the flag was raised. */
  raised: number;
  /** Criteria without points that are not flags (lists, zero weight): answered, nothing to rank. */
  other: number;
  na: number;
  /** Points earned over points possible among answered results; null when the criterion carries no points. */
  earnedShare: number | null;
};

export type StatsInput = {
  conversations: Conversation[];
  /** In creation order, as the API lists them: the last per dialog is the current one. */
  evaluations: Evaluation[];
  checklists: ChecklistVersion[];
  appeals: Appeal[];
  language: Language | 'all';
  /** Checklist version of the criterion table; null picks the one most evaluations used. */
  checklistId: string | null;
};

export type Stats = {
  dialogs: number;
  evaluated: number;
  failed: number;
  notEvaluated: number;
  averageTotal: number | null;
  seriousViolations: number;
  needReview: number;
  /** Checklist versions with at least one evaluation in scope, most used first; `used` counts evaluations. */
  versions: { checklist: ChecklistVersion; used: number }[];
  checklist: ChecklistVersion | null;
  criteria: CriterionStat[];
  appeals: { pending: number; upheld: number; overridden: number; corrections: number };
  /** Results in scope and how many a reviewer changed (decided appeals and corrections both end up in finalResults). */
  reviewedResults: { total: number; changed: number };
  /** Human check of the dialogs in scope (a check of an older evaluation counts as new again). */
  review: { new: number; in_review: number; reviewed: number };
  /** One row per assigned operator, then dialogs nobody is assigned to (`operator: null`). */
  byOperator: { operator: string | null; dialogs: number; evaluated: number; averageTotal: number | null; seriousViolations: number; reviewed: number; appealsPending: number; appealsTotal: number; changed: number; results: number }[];
  byLanguage: { language: Language; dialogs: number; evaluated: number; averageTotal: number | null; seriousViolations: number }[];
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function computeStats({ conversations, evaluations, checklists, appeals, language, checklistId }: StatsInput): Stats {
  const { preferred: latest, attempts } = evaluationMaps(evaluations);

  const inScope = conversations.filter((c) => language === 'all' || c.language === language);
  const current = inScope.map((c) => latest.get(c.id)).filter((e): e is Evaluation => !!e);
  const done = current.filter((e) => e.status === 'completed');
  const scopeEvaluationIds = new Set(current.map((e) => e.id));

  const usage = new Map<string, number>();
  for (const e of done) usage.set(e.checklistVersionId, (usage.get(e.checklistVersionId) ?? 0) + 1);
  const versions = checklists
    .filter((c) => usage.has(c.id))
    .map((checklist) => ({ checklist, used: usage.get(checklist.id)! }))
    .sort((a, b) => b.used - a.used || b.checklist.version - a.checklist.version);
  const checklist = versions.find((v) => v.checklist.id === checklistId)?.checklist ?? versions[0]?.checklist ?? null;

  const criteria: CriterionStat[] = (checklist?.criteria ?? []).map((criterion) => {
    const s = { full: 0, partial: 0, zero: 0, raised: 0, other: 0, na: 0, total: 0 };
    let earned = 0;
    let possible = 0;
    for (const e of done) {
      if (e.checklistVersionId !== checklist!.id) continue;
      const r = e.finalResults.find((x) => x.criterionId === criterion.id);
      if (!r) continue;
      s.total++;
      if (r.isNA) s.na++;
      else if (criterion.criticalFlag) r.value === true ? s.raised++ : s.other++;
      else {
        const pts = earnedPoints(criterion, r);
        if (pts === null) s.other++;
        else {
          earned += pts;
          possible += criterion.weight;
          if (pts >= criterion.weight) s.full++;
          else if (pts > 0) s.partial++;
          else s.zero++;
        }
      }
    }
    return { criterion, ...s, earnedShare: possible > 0 ? earned / possible : null };
  });

  const scopeAppeals = appeals.filter((a) => scopeEvaluationIds.has(a.evaluationId));
  const real = scopeAppeals.filter((a) => a.kind !== 'correction');
  let total = 0;
  let changed = 0;
  for (const e of done) {
    const original = new Map(e.originalResults.map((r) => [r.criterionId, r]));
    for (const r of e.finalResults) {
      total++;
      if (!sameResult(original.get(r.criterionId), r)) changed++;
    }
  }

  const languages = [...new Set(conversations.map((c) => c.language))].sort();
  const byLanguage = languages.map((l) => {
    const evals = conversations.filter((c) => c.language === l).map((c) => latest.get(c.id)).filter((e): e is Evaluation => e?.status === 'completed');
    return {
      language: l,
      dialogs: conversations.filter((c) => c.language === l).length,
      evaluated: evals.length,
      averageTotal: mean(evals.flatMap((e) => (e.finalTotal === null ? [] : [e.finalTotal]))),
      seriousViolations: evals.filter((e) => e.seriousViolation).length,
    };
  });

  const stage = (cs: Conversation[]) => cs.map((c) => reviewOf(c, latest.get(c.id)).state);
  const states = stage(inScope);
  const operatorNames = [...new Set(inScope.map((c) => c.operatorId).filter((o): o is string => !!o))].sort((a, b) => a.localeCompare(b, 'ru'));
  const byOperator = [...operatorNames, null].flatMap((operator) => {
    const cs = inScope.filter((c) => (c.operatorId ?? null) === operator);
    if (cs.length === 0) return [];
    const evals = cs.map((c) => latest.get(c.id)).filter((e): e is Evaluation => e?.status === 'completed');
    const ids = new Set(evals.map((e) => e.id));
    const theirs = appeals.filter((a) => a.kind !== 'correction' && ids.has(a.evaluationId));
    let results = 0;
    let changed = 0;
    for (const e of evals) {
      const original = new Map(e.originalResults.map((r) => [r.criterionId, r]));
      for (const r of e.finalResults) {
        results++;
        if (!sameResult(original.get(r.criterionId), r)) changed++;
      }
    }
    return [{
      operator,
      dialogs: cs.length,
      evaluated: evals.length,
      averageTotal: mean(evals.flatMap((e) => (e.finalTotal === null ? [] : [e.finalTotal]))),
      seriousViolations: evals.filter((e) => e.seriousViolation).length,
      reviewed: stage(cs).filter((x) => x === 'reviewed').length,
      appealsPending: theirs.filter((a) => a.status === 'pending').length,
      appealsTotal: theirs.length,
      changed,
      results,
    }];
  });

  return {
    review: { new: states.filter((x) => x === 'new').length, in_review: states.filter((x) => x === 'in_review').length, reviewed: states.filter((x) => x === 'reviewed').length },
    byOperator,
    dialogs: inScope.length,
    evaluated: done.length,
    failed: inScope.filter(c => attempts.get(c.id)?.status === 'failed').length,
    notEvaluated: inScope.length - current.length,
    averageTotal: mean(done.flatMap((e) => (e.finalTotal === null ? [] : [e.finalTotal]))),
    seriousViolations: done.filter((e) => e.seriousViolation).length,
    needReview: done.filter((e) => e.finalResults.some(needsReview)).length,
    versions,
    checklist,
    criteria,
    appeals: {
      pending: real.filter((a) => a.status === 'pending').length,
      upheld: real.filter((a) => a.status === 'upheld').length,
      overridden: real.filter((a) => a.status === 'overridden').length,
      corrections: scopeAppeals.filter((a) => a.kind === 'correction').length,
    },
    reviewedResults: { total, changed },
    byLanguage,
  };
}
