import { createHash } from 'node:crypto';
import { criterionSignature, type Conversation, type CriterionResult } from '@cqa/contracts';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { evaluations } from '../../db/schema.js';
import { getChecklist } from '../checklists.js';
import { toEvaluation } from '../evaluations.js';
import { getConversation } from '../conversations.js';
import { PROMPT_VERSION } from './prompts.js';
import type { LlmProvider } from './provider.js';
import type { ReuseLookup } from './evaluator.js';

// Bump when deterministic rules, attribution validation or reuse semantics change.
export const EVALUATOR_VERSION = 'operator-v2';

export function evaluationCacheContext(conversation: Conversation, provider?: LlmProvider): string {
  return JSON.stringify({
    inputHash: createHash('sha256').update(JSON.stringify(conversation)).digest('hex'),
    evaluatorVersion: EVALUATOR_VERSION, promptVersion: PROMPT_VERSION,
    provider: provider?.name ?? null, model: provider?.model ?? null, effort: provider?.effort ?? null,
  });
}

function compatible(stored: string | null, current: string, hasProvider: boolean): boolean {
  if (!stored) return false;
  try {
    const a = JSON.parse(stored), b = JSON.parse(current);
    return a.inputHash === b.inputHash && a.evaluatorVersion === b.evaluatorVersion && a.promptVersion === b.promptVersion
      && (!hasProvider || (a.provider === b.provider && a.model === b.model && a.effort === b.effort));
  } catch { return false; }
}

/**
 * Index of what is already known about a conversation: for every criterion signature, the newest
 * original (pre-override) result from a completed evaluation. Reviewer overrides are not carried over:
 * a new evaluation is a fresh AI/rule decision that can be appealed again.
 */
export function makeReuseLookup(db: Db, conversationId: string, provider?: LlmProvider): ReuseLookup {
  const conversation = getConversation(db, conversationId);
  if (!conversation) return () => undefined;
  const context = evaluationCacheContext(conversation, provider);
  const bySignature = new Map<string, { result: CriterionResult; evaluationId: string }>();
  const rows = db.select().from(evaluations).where(eq(evaluations.conversationId, conversationId)).orderBy(desc(evaluations.createdAt), desc(evaluations.id)).all();
  for (const row of rows) {
    if (row.status !== 'completed' || !compatible(row.cacheContext, context, !!provider)) continue;
    const ev = toEvaluation(row);
    const checklist = getChecklist(db, ev.checklistVersionId);
    if (!checklist) continue;
    for (const c of checklist.criteria) {
      const result = ev.originalResults.find((r) => r.criterionId === c.id);
      const sig = criterionSignature(c);
      if (result && !bySignature.has(sig)) bySignature.set(sig, { result, evaluationId: ev.id });
    }
  }
  return (sig) => bySignature.get(sig);
}
