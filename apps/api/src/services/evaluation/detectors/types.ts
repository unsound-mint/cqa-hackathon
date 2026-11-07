import type { Conversation, Criterion, CriterionResult, TranscriptMessage } from '@cqa/contracts';
import type { deriveFacts } from '../facts.js';

export type DetectorInput = { conversation: Conversation; facts: ReturnType<typeof deriveFacts>; criterion: Criterion };

/**
 * A deterministic rule that may decide ONE criterion. Contract: it only returns a result when the text PROVES
 * the answer; otherwise null ("undecided") and the model decides. A missed pattern must never become a "No".
 */
export type Detector = {
  name: string;
  description: string;
  run(input: DetectorInput): CriterionResult | null;
};

/** First human operator turn: the operator's messages up to the first client/bot message (system events skipped). */
export function firstOperatorTurn(c: Conversation): TranscriptMessage[] {
  const t = c.transcript;
  const start = t.findIndex((m) => m.speaker === 'operator');
  if (start < 0) return [];
  const turn: TranscriptMessage[] = [];
  for (let i = start; i < t.length; i++) {
    const m = t[i]!;
    if (m.speaker === 'operator') turn.push(m);
    else if (m.speaker !== 'system') break;
  }
  return turn;
}

/** Last operator turn: the final run of operator messages (system events skipped). */
export function lastOperatorTurn(c: Conversation): TranscriptMessage[] {
  const t = c.transcript;
  let end = t.length - 1;
  while (end >= 0 && t[end]!.speaker !== 'operator') end--;
  if (end < 0) return [];
  const turn: TranscriptMessage[] = [];
  for (let i = end; i >= 0; i--) {
    const m = t[i]!;
    if (m.speaker === 'operator') turn.unshift(m);
    else if (m.speaker !== 'system') break;
  }
  return turn;
}

export const isBooleanYesNo = (c: Criterion) => c.kind === 'boolean' && c.allowedValues.includes(true);

/** Unicode-aware "word" boundaries (JS \b is ASCII-only). */
export const L = '(?<![\\p{L}\\p{N}])';
export const R = '(?![\\p{L}\\p{N}])';
