import { type Actor, type AssignOperatorInput, type SetReviewInput } from '@cqa/contracts';
import { desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { conversations, evaluations, operatorAssignments, reviews } from '../db/schema.js';
import { ApiError } from './errors.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const latestEvaluationId = (tx: Tx | Db, conversationId: string) =>
  tx.select({ id: evaluations.id }).from(evaluations).where(eq(evaluations.conversationId, conversationId)).orderBy(desc(evaluations.createdAt), desc(evaluations.id)).get()?.id;

/** `new` reopens the dialog (drops the review); the others are bound to the dialog's latest evaluation. */
export function setReview(db: Db, conversationId: string, input: SetReviewInput, actor?: Actor): void {
  db.transaction((tx) => {
    if (!tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, conversationId)).get()) throw new ApiError('conversation not found', 404);
    if (input.status === 'new') {
      tx.delete(reviews).where(eq(reviews.conversationId, conversationId)).run();
      return;
    }
    const evaluationId = latestEvaluationId(tx, conversationId);
    if (!evaluationId) throw new ApiError('the dialog has no evaluation to review yet', 409);
    const row = { conversationId, status: input.status, evaluationId, by: actor?.name || 'система', at: new Date().toISOString() };
    tx.insert(reviews).values(row).onConflictDoUpdate({ target: reviews.conversationId, set: row }).run();
  });
}

/**
 * A reviewer who changes a criterion has looked at the dialog, but one criterion is not a full check: it moves the
 * dialog to "in review" and only the explicit action marks it reviewed. A review already on this evaluation stays.
 */
export function noteReviewActivity(tx: Tx, evaluationId: string, actor: Actor | undefined): void {
  if (!actor || actor.role === 'operator') return;
  const conversationId = tx.select({ id: evaluations.conversationId }).from(evaluations).where(eq(evaluations.id, evaluationId)).get()?.id;
  if (!conversationId) return;
  const existing = tx.select().from(reviews).where(eq(reviews.conversationId, conversationId)).get();
  if (existing && existing.evaluationId === evaluationId) return;
  const row = { conversationId, status: 'in_review', evaluationId, by: actor.name || 'система', at: new Date().toISOString() };
  tx.insert(reviews).values(row).onConflictDoUpdate({ target: reviews.conversationId, set: row }).run();
}

export function assignOperator(db: Db, input: AssignOperatorInput, actor?: Actor): void {
  const ids = [...new Set(input.conversationIds)];
  db.transaction((tx) => {
    const known = new Set(tx.select({ id: conversations.id }).from(conversations).where(inArray(conversations.id, ids)).all().map((r) => r.id));
    const missing = ids.find((id) => !known.has(id));
    if (missing) throw new ApiError(`conversation ${missing} not found`, 404);
    if (input.operator === null) {
      tx.delete(operatorAssignments).where(inArray(operatorAssignments.conversationId, ids)).run();
      return;
    }
    const at = new Date().toISOString();
    for (const conversationId of ids) {
      const row = { conversationId, operator: input.operator, assignedBy: actor?.name || null, assignedAt: at };
      tx.insert(operatorAssignments).values(row).onConflictDoUpdate({ target: operatorAssignments.conversationId, set: row }).run();
    }
  });
}

export function listOperators(db: Db): string[] {
  return [...new Set(db.select({ operator: operatorAssignments.operator }).from(operatorAssignments).all().map((r) => r.operator))].sort((a, b) => a.localeCompare(b, 'ru'));
}
