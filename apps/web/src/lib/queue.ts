import type { Channel, ChecklistVersion, Conversation, Evaluation, Language } from '@cqa/contracts';
import { needsReview } from './present';

export type Quick = 'all' | 'violations' | 'review' | 'unevaluated' | 'followup';
/** Dialogs whose serious violation is not dealt with yet (see analytics `followUp`); passed in because it needs the comments. */
export type QueueContext = { followUpOpen?: ReadonlySet<string> };
/** Where a dialog stands in the human check. */
export type ReviewState = 'new' | 'in_review' | 'reviewed';
/** Order of the queue: `queue` = what to look at first; the others are the columns. */
export type SortKey = 'queue' | 'id' | 'score' | 'imported' | 'review';
export type Sort = { key: SortKey; dir: 1 | -1 };
/** `operator`: a name, 'none' for dialogs nobody is assigned to, or 'all'. */
export type Filters = { query: string; lang: Language | 'all'; channel: Channel | 'all'; quick: Quick; review: ReviewState | 'all'; operator: string; sort: Sort };
export const NO_OPERATOR = 'none';
export const DEFAULT_SORT: Sort = { key: 'queue', dir: 1 };
export const DEFAULT_FILTERS: Filters = { query: '', lang: 'all', channel: 'all', quick: 'all', review: 'all', operator: 'all', sort: DEFAULT_SORT };

const done = (e: Evaluation | undefined): e is Evaluation => e?.status === 'completed';

export const hasViolation = (e: Evaluation | undefined) => done(e) && e.seriousViolation;
/** Needs a human look: a raised violation, low-confidence results or a failed evaluation. */
export const needsAttention = (e: Evaluation | undefined) => !!e && (e.status === 'failed' || hasViolation(e) || reviewCount(e) > 0);
export const reviewCount = (e: Evaluation | undefined) => (done(e) ? e.finalResults.filter(needsReview).length : 0);

/** Why a violation was raised: the explanation of each raised flag criterion of the checklist the evaluation used. */
export function violationReasons(e: Evaluation | undefined, checklist: ChecklistVersion | undefined): { criterionId: string; title: string; explanation: string }[] {
  if (!done(e) || !e.seriousViolation) return [];
  return e.finalResults
    .filter((r) => r.value === true && checklist?.criteria.find((c) => c.id === r.criterionId)?.criticalFlag)
    .map((r) => ({ criterionId: r.criterionId, title: checklist?.criteria.find((c) => c.id === r.criterionId)?.title ?? r.criterionId, explanation: r.explanation }));
}

/**
 * A review counts only for the evaluation that was looked at: when the dialog was evaluated again afterwards the
 * earlier check is stale and the dialog is new again (`stale` says why, so the screen can).
 */
export function reviewOf(c: Conversation, e: Evaluation | undefined): { state: ReviewState; stale: boolean; by?: string; at?: string } {
  const r = c.review;
  if (!r) return { state: 'new', stale: false };
  if (!e || r.evaluationId !== e.id) return { state: 'new', stale: true, by: r.by, at: r.at };
  return { state: r.status, stale: false, by: r.by, at: r.at };
}

const REVIEW_RANK: Record<ReviewState, number> = { new: 0, in_review: 1, reviewed: 2 };

/**
 * The queue is ordered by what needs a person first: unreviewed before reviewed, a serious violation before a plain
 * score, the lowest score first, then by id so the order is stable. Columns sort by their own value, ties by id.
 */
export function sortConversations(list: Conversation[], latest: Map<string, Evaluation>, sort: Sort): Conversation[] {
  const score = (c: Conversation) => (done(latest.get(c.id)) ? latest.get(c.id)!.finalTotal ?? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY); // not evaluated: last in a low-first order
  const rank = (c: Conversation) => REVIEW_RANK[reviewOf(c, latest.get(c.id)).state];
  const imported = (c: Conversation) => c.importedAt ?? '';
  const byId = (a: Conversation, b: Conversation) => a.id.localeCompare(b.id, 'ru', { numeric: true });
  const cmp = (a: Conversation, b: Conversation): number => {
    switch (sort.key) {
      case 'id':
        return byId(a, b) * sort.dir;
      case 'score':
        return (score(a) - score(b) || 0) * sort.dir || byId(a, b);
      case 'imported':
        return imported(a).localeCompare(imported(b)) * sort.dir || byId(a, b);
      case 'review':
        return (rank(a) - rank(b)) * sort.dir || byId(a, b);
      default:
        return rank(a) - rank(b) || Number(hasViolation(latest.get(b.id))) - Number(hasViolation(latest.get(a.id))) || score(a) - score(b) || byId(a, b);
    }
  };
  return [...list].sort(cmp);
}

export function matches(c: Conversation, e: Evaluation | undefined, f: Filters, ctx: QueueContext = {}): boolean {
  if (f.quick === 'followup' && !ctx.followUpOpen?.has(c.id)) return false;
  if (f.review !== 'all' && reviewOf(c, e).state !== f.review) return false;
  if (f.operator !== 'all' && (f.operator === NO_OPERATOR ? !!c.operatorId : c.operatorId !== f.operator)) return false;
  if (f.lang !== 'all' && c.language !== f.lang) return false;
  if (f.channel !== 'all' && c.channel !== f.channel) return false;
  if (f.quick === 'violations' && !hasViolation(e)) return false;
  if (f.quick === 'review' && reviewCount(e) === 0) return false;
  if (f.quick === 'unevaluated' && e) return false;
  const q = f.query.trim().toLowerCase();
  return !q || c.id.toLowerCase().includes(q) || c.transcript.some((m) => m.text.toLowerCase().includes(q));
}

export function counts(conversations: Conversation[], latest: Map<string, Evaluation>, ctx: QueueContext = {}) {
  return {
    followup: conversations.filter((c) => ctx.followUpOpen?.has(c.id)).length,
    all: conversations.length,
    violations: conversations.filter((c) => hasViolation(latest.get(c.id))).length,
    review: conversations.filter((c) => reviewCount(latest.get(c.id)) > 0).length,
    unevaluated: conversations.filter((c) => !latest.get(c.id)).length,
    new: conversations.filter((c) => reviewOf(c, latest.get(c.id)).state === 'new').length,
    in_review: conversations.filter((c) => reviewOf(c, latest.get(c.id)).state === 'in_review').length,
    reviewed: conversations.filter((c) => reviewOf(c, latest.get(c.id)).state === 'reviewed').length,
  };
}
