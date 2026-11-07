import type { Conversation, CriterionResult } from './domain.js';

/**
 * Grounding check against the UNTOUCHED transcript: indices exist, quotes occur verbatim in the
 * referenced message, checkedRange stays inside the transcript. Returns human-readable problems.
 * Speaker rules (e.g. a bot message never satisfies an operator-action criterion) are criterion
 * semantics and live with the evaluator, not here.
 */
export function findEvidenceProblems(conversation: Conversation, results: readonly CriterionResult[]): string[] {
  const n = conversation.transcript.length;
  const problems: string[] = [];
  for (const r of results) {
    for (const e of r.evidence) {
      const m = conversation.transcript[e.messageIndex];
      if (!m) {
        problems.push(`${r.criterionId}: evidence index ${e.messageIndex} is outside 0..${n - 1}`);
      } else if (e.quote !== undefined && !m.text.includes(e.quote)) {
        problems.push(`${r.criterionId}: quote not found verbatim in message ${e.messageIndex}`);
      }
    }
    if (r.checkedRange && r.checkedRange.to > n - 1) {
      problems.push(`${r.criterionId}: checkedRange ${r.checkedRange.from}..${r.checkedRange.to} is outside 0..${n - 1}`);
    }
  }
  return problems;
}
