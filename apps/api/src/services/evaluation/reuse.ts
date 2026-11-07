import { criterionSignature, type CriterionResult } from '@cqa/contracts';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { evaluations } from '../../db/schema.js';
import { getChecklist } from '../checklists.js';
import { toEvaluation } from '../evaluations.js';
import type { ReuseLookup } from './evaluator.js';

/**
 * Index of what is already known about a conversation: for every criterion signature, the newest
 * original (pre-override) result from a completed evaluation. Reviewer overrides are not carried over:
 * a new evaluation is a fresh AI/rule decision that can be appealed again.
 */
export function makeReuseLookup(db: Db, conversationId: string): ReuseLookup {
  const bySignature = new Map<string, { result: CriterionResult; evaluationId: string }>();
  const rows = db.select().from(evaluations).where(eq(evaluations.conversationId, conversationId)).orderBy(desc(evaluations.createdAt), desc(evaluations.id)).all();
  for (const row of rows) {
    if (row.status !== 'completed') continue;
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
