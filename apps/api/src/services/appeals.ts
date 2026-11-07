import { AppealSchema, ScoringError, canSee, scoreEvaluation, type Actor, type Appeal, type CreateAppealInput, type CriterionValue, type DecideAppealInput, type OverrideCriterionInput } from '@cqa/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import { appeals, conversations, evaluations, operatorAssignments } from '../db/schema.js';
import { getChecklist } from './checklists.js';
import { scopeOf } from './directory.js';
import { ApiError } from './errors.js';
import { logEvent } from './events.js';
import { notify } from './notifications.js';
import { responsibleFor } from './directory.js';
import { toEvaluation } from './evaluations.js';
import { noteReviewActivity } from './review.js';

/** Service error carrying the HTTP status the route should answer with. */
export class AppealError extends ApiError {}

function toAppeal(row: typeof appeals.$inferSelect): Appeal {
  return AppealSchema.parse({
    ...row,
    kind: row.kind ?? 'appeal',
    createdBy: row.createdBy ?? undefined,
    decidedBy: row.decidedBy ?? undefined,
    decidedAt: row.decidedAt ?? undefined,
    reviewerReason: row.reviewerReason ?? undefined,
    reviewerValue: row.reviewerValue === null ? undefined : row.reviewerValue,
    reviewerIsNA: row.reviewerIsNA ?? undefined,
  });
}

/** Ties on created_at (same millisecond) fall back to insertion order (rowid), not the random id. */
export function listAppeals(db: Db, evaluationId: string): Appeal[] {
  return db.select().from(appeals).where(eq(appeals.evaluationId, evaluationId)).orderBy(asc(appeals.createdAt), asc(sql`rowid`)).all().map(toAppeal);
}

/** Whether the actor may see the dialog this evaluation belongs to (operators: only their own). */
export function evaluationVisible(db: Db, evaluationId: string, actor: Actor | undefined): boolean {
  const scope = scopeOf(db, actor);
  if (scope === null) return true;
  const conversationId = db.select({ id: evaluations.conversationId }).from(evaluations).where(eq(evaluations.id, evaluationId)).get()?.id;
  const operator = conversationId ? db.select().from(operatorAssignments).where(eq(operatorAssignments.conversationId, conversationId)).get()?.operator : undefined;
  return canSee(scope, { operatorId: operator });
}

/** Appeals across all dialogs, oldest first (the approver's queue), optionally only one status. An operator gets their own dialogs' appeals only. */
export function listAllAppeals(db: Db, status?: Appeal['status'], actor?: Actor): Appeal[] {
  const rows = db.select().from(appeals).where(status ? eq(appeals.status, status) : undefined).orderBy(asc(appeals.createdAt), asc(sql`rowid`)).all();
  const scope = scopeOf(db, actor);
  if (scope === null) return rows.map(toAppeal);
  const mine = new Set(db.select({ id: conversations.id }).from(conversations).all().map((c) => c.id).filter((id) => canSee(scope, { operatorId: db.select().from(operatorAssignments).where(eq(operatorAssignments.conversationId, id)).get()?.operator })));
  const evs = new Set(db.select({ id: evaluations.id, c: evaluations.conversationId }).from(evaluations).all().filter((e) => mine.has(e.c)).map((e) => e.id));
  return rows.filter((r) => evs.has(r.evaluationId)).map(toAppeal);
}

export function createAppeal(db: Db, input: CreateAppealInput, actor?: Actor): Appeal {
  if (!evaluationVisible(db, input.evaluationId, actor)) throw new AppealError('evaluation not found', 404);
  return db.transaction((tx) => {
    const ev = tx.select().from(evaluations).where(eq(evaluations.id, input.evaluationId)).get();
    if (!ev) throw new AppealError('evaluation not found', 404);
    if (ev.status !== 'completed') throw new AppealError('only a completed evaluation can be appealed', 409);
    if (!toEvaluation(ev).originalResults.some((r) => r.criterionId === input.criterionId)) throw new AppealError('criterion is not part of this evaluation', 400);
    if (pendingFor(tx, input.evaluationId, input.criterionId)) throw new AppealError('a pending appeal already exists for this criterion', 409);
    const row = { id: `appeal-${randomUUID()}`, ...input, kind: 'appeal', status: 'pending', createdAt: new Date().toISOString(), createdBy: actor?.name || null, decidedBy: null, decidedAt: null, reviewerReason: null, reviewerValue: null, reviewerIsNA: null };
    tx.insert(appeals).values(row).run();
    logEvent(tx, actor, { type: 'appeal.filed', conversationId: ev.conversationId, summary: `Апелляция по критерию ${input.criterionId}`, data: { appealId: row.id, criterionId: input.criterionId, evaluationId: ev.id } });
    const who = responsibleFor(db, ev.conversationId);
    if (who.managerId) notify(tx, [who.managerId], { kind: 'appeal', title: `Апелляция: ${ev.conversationId}`, body: `Оператор оспорил критерий ${input.criterionId}.`, conversationId: ev.conversationId, criterionId: input.criterionId });
    return toAppeal(row);
  });
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Rewrites ONLY final_results / final_total / serious_violation of one evaluation, recomputed with the shared scorer
 * from the stored checklist version; original_* columns are never written. Invalid values change nothing.
 * The result keeps the AI's evidence and range (still the messages in question) but carries the reviewer's reason
 * as its explanation and `source: 'reviewer'`; the AI's own explanation stays in originalResults.
 */
function applyOverride(db: Db, tx: Tx, evaluationId: string, criterionId: string, d: { reason: string; value?: CriterionValue | null; isNA?: boolean }) {
  const row = tx.select().from(evaluations).where(eq(evaluations.id, evaluationId)).get();
  if (!row) throw new AppealError('evaluation not found', 404);
  const ev = toEvaluation(row);
  if (ev.status !== 'completed') throw new AppealError('only a completed evaluation can be changed', 409);
  if (!ev.finalResults.some((r) => r.criterionId === criterionId)) throw new AppealError('criterion is not part of this evaluation', 400);
  const checklist = getChecklist(db, ev.checklistVersionId);
  if (!checklist) throw new AppealError('checklist version of this evaluation is missing', 409);
  const before = ev.finalResults.find((r) => r.criterionId === criterionId)!;
  const isNA = d.isNA === true;
  const value = isNA ? null : (d.value ?? null);
  const next = ev.finalResults.map((r) => {
    if (r.criterionId !== criterionId) return r;
    const { confidence: _c, reusedFrom: _r, naReason: _n, ...rest } = r;
    return { ...rest, value, isNA, ...(isNA ? { naReason: d.reason } : {}), explanation: d.reason, source: 'reviewer' as const };
  });
  let scored;
  try {
    scored = scoreEvaluation(checklist, next);
  } catch (e) {
    if (e instanceof ScoringError) throw new AppealError(e.message, 400);
    throw e;
  }
  tx.update(evaluations).set({ finalResults: next, finalTotal: scored.total, seriousViolation: scored.seriousViolation }).where(eq(evaluations.id, ev.id)).run();
  return { value, isNA, before: { value: before.value, isNA: before.isNA }, conversationId: ev.conversationId };
}

const pendingFor = (tx: Tx, evaluationId: string, criterionId: string) =>
  tx.select().from(appeals).where(and(eq(appeals.evaluationId, evaluationId), eq(appeals.criterionId, criterionId), eq(appeals.status, 'pending'))).get();

/** Uphold keeps the AI result; override applies the reviewer's value (see applyOverride). */
export function decideAppeal(db: Db, input: DecideAppealInput, actor?: Actor): Appeal {
  return db.transaction((tx) => {
    const appeal = tx.select().from(appeals).where(eq(appeals.id, input.appealId)).get();
    if (!appeal) throw new AppealError('appeal not found', 404);
    if (appeal.status !== 'pending') throw new AppealError(`appeal is already ${appeal.status}`, 409);
    const decidedAt = new Date().toISOString();

    if (input.action === 'uphold') {
      tx.update(appeals).set({ status: 'upheld', decidedAt, decidedBy: actor?.name || null, reviewerReason: input.reason }).where(eq(appeals.id, appeal.id)).run();
      noteReviewActivity(tx, appeal.evaluationId, actor);
    } else {
      const { value, isNA, before, conversationId } = applyOverride(db, tx, appeal.evaluationId, appeal.criterionId, input);
      logEvent(tx, actor, { type: 'result.corrected', conversationId, summary: `Изменена оценка критерия ${appeal.criterionId} по апелляции`, data: { criterionId: appeal.criterionId, before, after: { value, isNA }, viaAppeal: appeal.id, evaluationId: appeal.evaluationId } });
      tx.update(appeals).set({ status: 'overridden', decidedAt, decidedBy: actor?.name || null, reviewerReason: input.reason, reviewerValue: value, reviewerIsNA: isNA }).where(eq(appeals.id, appeal.id)).run();
      noteReviewActivity(tx, appeal.evaluationId, actor);
    }
    const evRow = tx.select({ c: evaluations.conversationId }).from(evaluations).where(eq(evaluations.id, appeal.evaluationId)).get();
    if (evRow) {
      logEvent(tx, actor, { type: 'appeal.decided', conversationId: evRow.c, summary: `Апелляция по критерию ${appeal.criterionId}: ${input.action === 'uphold' ? 'оценка ИИ оставлена' : 'оценка изменена'}`, data: { appealId: appeal.id, criterionId: appeal.criterionId, action: input.action, evaluationId: appeal.evaluationId } });
      const who = responsibleFor(db, evRow.c);
      if (who.operatorId) notify(tx, [who.operatorId], { kind: 'appeal', title: `Решение по апелляции: ${evRow.c}`, body: `Критерий ${appeal.criterionId}: ${input.action === 'uphold' ? 'оценка ИИ оставлена' : 'оценка изменена'}. ${input.reason}`, conversationId: evRow.c, criterionId: appeal.criterionId });
    }
    return toAppeal(tx.select().from(appeals).where(eq(appeals.id, appeal.id)).get()!);
  });
}

/** A reviewer changes a criterion directly; recorded as an already-decided 'correction' for the audit history. */
export function overrideCriterion(db: Db, input: OverrideCriterionInput, actor?: Actor): Appeal {
  return db.transaction((tx) => {
    if (pendingFor(tx, input.evaluationId, input.criterionId)) throw new AppealError('this criterion has a pending appeal: decide the appeal instead', 409);
    const { value, isNA, before, conversationId } = applyOverride(db, tx, input.evaluationId, input.criterionId, input);
    logEvent(tx, actor, { type: 'result.corrected', conversationId, summary: `Исправлена оценка критерия ${input.criterionId}`, data: { criterionId: input.criterionId, before, after: { value, isNA }, evaluationId: input.evaluationId } });
    const now = new Date().toISOString();
    const row = { id: `appeal-${randomUUID()}`, evaluationId: input.evaluationId, criterionId: input.criterionId, kind: 'correction', comment: '', status: 'overridden', createdAt: now, createdBy: actor?.name || null, decidedBy: actor?.name || null, decidedAt: now, reviewerReason: input.reason, reviewerValue: value, reviewerIsNA: isNA };
    tx.insert(appeals).values(row).run();
    noteReviewActivity(tx, input.evaluationId, actor);
    return toAppeal(row);
  });
}
