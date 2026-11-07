import { AppealSchema, ScoringError, scoreEvaluation, type Appeal, type CreateAppealInput, type DecideAppealInput } from '@cqa/contracts';
import { and, asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import { appeals, evaluations } from '../db/schema.js';
import { getChecklist } from './checklists.js';
import { toEvaluation } from './evaluations.js';

/** Service error carrying the HTTP status the route should answer with. */
export class AppealError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

function toAppeal(row: typeof appeals.$inferSelect): Appeal {
  return AppealSchema.parse({
    ...row,
    decidedAt: row.decidedAt ?? undefined,
    reviewerReason: row.reviewerReason ?? undefined,
    reviewerValue: row.reviewerValue === null ? undefined : row.reviewerValue,
    reviewerIsNA: row.reviewerIsNA ?? undefined,
  });
}

export function listAppeals(db: Db, evaluationId: string): Appeal[] {
  return db.select().from(appeals).where(eq(appeals.evaluationId, evaluationId)).orderBy(asc(appeals.createdAt), asc(appeals.id)).all().map(toAppeal);
}

export function createAppeal(db: Db, input: CreateAppealInput): Appeal {
  return db.transaction((tx) => {
    const ev = tx.select().from(evaluations).where(eq(evaluations.id, input.evaluationId)).get();
    if (!ev) throw new AppealError('evaluation not found', 404);
    if (ev.status !== 'completed') throw new AppealError('only a completed evaluation can be appealed', 409);
    if (!toEvaluation(ev).originalResults.some((r) => r.criterionId === input.criterionId)) throw new AppealError('criterion is not part of this evaluation', 400);
    const open = tx.select().from(appeals).where(and(eq(appeals.evaluationId, input.evaluationId), eq(appeals.criterionId, input.criterionId), eq(appeals.status, 'pending'))).get();
    if (open) throw new AppealError('a pending appeal already exists for this criterion', 409);
    const row = { id: `appeal-${randomUUID()}`, ...input, status: 'pending', createdAt: new Date().toISOString(), decidedAt: null, reviewerReason: null, reviewerValue: null, reviewerIsNA: null };
    tx.insert(appeals).values(row).run();
    return toAppeal(row);
  });
}

/**
 * Uphold keeps the AI result. Override rewrites ONLY final_results / final_total / serious_violation,
 * recomputed with the shared scorer from the stored checklist version; original_* columns are never written.
 * Invalid overrides (value not allowed, N/A not permitted) change nothing.
 */
export function decideAppeal(db: Db, input: DecideAppealInput): Appeal {
  return db.transaction((tx) => {
    const appeal = tx.select().from(appeals).where(eq(appeals.id, input.appealId)).get();
    if (!appeal) throw new AppealError('appeal not found', 404);
    if (appeal.status !== 'pending') throw new AppealError(`appeal is already ${appeal.status}`, 409);
    const decidedAt = new Date().toISOString();

    if (input.action === 'uphold') {
      tx.update(appeals).set({ status: 'upheld', decidedAt, reviewerReason: input.reason }).where(eq(appeals.id, appeal.id)).run();
    } else {
      const ev = toEvaluation(tx.select().from(evaluations).where(eq(evaluations.id, appeal.evaluationId)).get()!);
      const checklist = getChecklist(db, ev.checklistVersionId);
      if (!checklist) throw new AppealError('checklist version of this evaluation is missing', 409);
      const isNA = input.isNA === true;
      const next = ev.finalResults.map((r) =>
        r.criterionId === appeal.criterionId
          ? { ...r, value: isNA ? null : (input.value ?? null), isNA, naReason: isNA ? input.reason : undefined, explanation: `Reviewer override: ${input.reason}` }
          : r,
      );
      let scored;
      try {
        scored = scoreEvaluation(checklist, next);
      } catch (e) {
        if (e instanceof ScoringError) throw new AppealError(e.message, 400);
        throw e;
      }
      tx.update(evaluations).set({ finalResults: next, finalTotal: scored.total, seriousViolation: scored.seriousViolation }).where(eq(evaluations.id, ev.id)).run();
      tx.update(appeals)
        .set({ status: 'overridden', decidedAt, reviewerReason: input.reason, reviewerValue: isNA ? null : (input.value ?? null), reviewerIsNA: isNA })
        .where(eq(appeals.id, appeal.id))
        .run();
    }
    return toAppeal(tx.select().from(appeals).where(eq(appeals.id, appeal.id)).get()!);
  });
}
