import type { Channel, ChecklistVersion, Conversation, Evaluation, Language } from '@cqa/contracts';
import { needsReview } from './present';

export type Quick = 'all' | 'violations' | 'review' | 'unevaluated';
export type Filters = { query: string; lang: Language | 'all'; channel: Channel | 'all'; quick: Quick };
export const DEFAULT_FILTERS: Filters = { query: '', lang: 'all', channel: 'all', quick: 'all' };

const done = (e: Evaluation | undefined): e is Evaluation => e?.status === 'completed';

export const hasViolation = (e: Evaluation | undefined) => done(e) && e.seriousViolation;
/** Needs a human look: a raised violation, low-confidence results or a failed evaluation. ("Already reviewed" is not tracked: the contract has no such state.) */
export const needsAttention = (e: Evaluation | undefined) => !!e && (e.status === 'failed' || hasViolation(e) || reviewCount(e) > 0);
export const reviewCount = (e: Evaluation | undefined) => (done(e) ? e.finalResults.filter(needsReview).length : 0);

/** Why a violation was raised: the explanation of each raised flag criterion of the checklist the evaluation used. */
export function violationReasons(e: Evaluation | undefined, checklist: ChecklistVersion | undefined): { criterionId: string; title: string; explanation: string }[] {
  if (!done(e) || !e.seriousViolation) return [];
  return e.finalResults
    .filter((r) => r.value === true && checklist?.criteria.find((c) => c.id === r.criterionId)?.criticalFlag)
    .map((r) => ({ criterionId: r.criterionId, title: checklist?.criteria.find((c) => c.id === r.criterionId)?.title ?? r.criterionId, explanation: r.explanation }));
}

export function matches(c: Conversation, e: Evaluation | undefined, f: Filters): boolean {
  if (f.lang !== 'all' && c.language !== f.lang) return false;
  if (f.channel !== 'all' && c.channel !== f.channel) return false;
  if (f.quick === 'violations' && !hasViolation(e)) return false;
  if (f.quick === 'review' && reviewCount(e) === 0) return false;
  if (f.quick === 'unevaluated' && e) return false;
  const q = f.query.trim().toLowerCase();
  return !q || c.id.toLowerCase().includes(q) || c.transcript.some((m) => m.text.toLowerCase().includes(q));
}

export function counts(conversations: Conversation[], latest: Map<string, Evaluation>) {
  return {
    all: conversations.length,
    violations: conversations.filter((c) => hasViolation(latest.get(c.id))).length,
    review: conversations.filter((c) => reviewCount(latest.get(c.id)) > 0).length,
    unevaluated: conversations.filter((c) => !latest.get(c.id)).length,
  };
}
