import {
  CommentSchema, CrosscheckSchema, TagSchema, TaskSchema, TaxonomyItemSchema, TimelineEventSchema, canSee, can,
  type Actor, type AddCommentInput, type AddTagInput, type Comment, type CreateTasksInput, type Crosscheck, type SaveTimelineEventInput,
  type SubmitCrosscheckInput, type Tag, type Task, type TaxonomyItem, type TimelineEvent,
} from '@cqa/contracts';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import { comments, conversations, crosschecks, evaluations, operatorAssignments, people, reviews, tags, tasks, taxonomy, timelineEvents } from '../db/schema.js';
import { getChecklist } from './checklists.js';
import { responsibleFor, scopeOf } from './directory.js';
import { ApiError } from './errors.js';
import { logEvent } from './events.js';
import { notify } from './notifications.js';

const operatorOf = (db: Db, conversationId: string) => db.select().from(operatorAssignments).where(eq(operatorAssignments.conversationId, conversationId)).get()?.operator;
const conversationExists = (db: Db, id: string) => !!db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, id)).get();
/** The dialog must exist and be inside the caller's scope (a manager: their team). */
function requireVisible(db: Db, conversationId: string, actor: Actor | undefined) {
  if (!conversationExists(db, conversationId) || !canSee(scopeOf(db, actor), { operatorId: operatorOf(db, conversationId) })) throw new ApiError('conversation not found', 404);
}
const latestEvaluation = (db: Db, conversationId: string) =>
  db.select().from(evaluations).where(eq(evaluations.conversationId, conversationId)).orderBy(desc(evaluations.createdAt), desc(evaluations.id)).get();

// ---------- comments ----------

const toComment = (r: typeof comments.$inferSelect): Comment => CommentSchema.parse({ ...r, criterionId: r.criterionId ?? undefined, authorId: r.authorId ?? undefined, ackedAt: r.ackedAt ?? undefined });

export function listComments(db: Db, actor: Actor | undefined): Comment[] {
  const scope = scopeOf(db, actor);
  const rows = db.select().from(comments).orderBy(asc(comments.createdAt)).all();
  if (scope === null) return rows.map(toComment);
  return rows.filter((r) => canSee(scope, { operatorId: operatorOf(db, r.conversationId) })).map(toComment);
}

export function addComment(db: Db, input: AddCommentInput, actor?: Actor): Comment {
  requireVisible(db, input.conversationId, actor);
  return db.transaction((tx) => {
    const row = { id: `c-${randomUUID()}`, conversationId: input.conversationId, criterionId: input.criterionId ?? null, authorId: actor?.id ?? null, authorName: actor?.name || 'система', body: input.body, createdAt: new Date().toISOString(), ackedAt: null };
    tx.insert(comments).values(row).run();
    logEvent(tx, actor, { type: 'comment.added', conversationId: input.conversationId, summary: `Комментарий${input.criterionId ? ` к критерию ${input.criterionId}` : ' к диалогу'}`, data: { commentId: row.id, criterionId: input.criterionId } });
    const who = responsibleFor(db, input.conversationId);
    if (who.operatorId) notify(tx, [who.operatorId], { kind: 'comment', title: `Комментарий к диалогу ${input.conversationId}`, body: input.body.slice(0, 200), conversationId: input.conversationId, ...(input.criterionId ? { criterionId: input.criterionId } : {}) });
    return toComment(row);
  });
}

/** Only the operator the dialog belongs to can acknowledge ("ознакомлен"). */
export function acknowledgeComment(db: Db, id: string, actor?: Actor): Comment {
  return db.transaction((tx) => {
    const row = tx.select().from(comments).where(eq(comments.id, id)).get();
    if (!row) throw new ApiError('comment not found', 404);
    const operator = operatorOf(db, row.conversationId);
    if (actor && (actor.role !== 'operator' || !operator || (actor.id ?? actor.name) !== operator)) throw new ApiError('only the operator of this dialog acknowledges a comment', 403);
    if (row.ackedAt) return toComment(row);
    const ackedAt = new Date().toISOString();
    tx.update(comments).set({ ackedAt }).where(eq(comments.id, id)).run();
    logEvent(tx, actor, { type: 'comment.acknowledged', conversationId: row.conversationId, summary: 'Комментарий прочитан оператором', data: { commentId: id } });
    return toComment({ ...row, ackedAt });
  });
}

// ---------- taxonomy and tags ----------

export const listTaxonomy = (db: Db): TaxonomyItem[] => db.select().from(taxonomy).orderBy(asc(taxonomy.label)).all().map((r) => TaxonomyItemSchema.parse({ ...r, criterionId: r.criterionId ?? undefined }));

export function addTaxonomyItem(db: Db, input: { label: string; criterionId?: string }, actor?: Actor): TaxonomyItem {
  const row = { id: `tx-${randomUUID()}`, label: input.label, criterionId: input.criterionId ?? null };
  db.transaction((tx) => {
    if (tx.select().from(taxonomy).where(and(eq(taxonomy.label, row.label), row.criterionId ? eq(taxonomy.criterionId, row.criterionId) : undefined)).get()) throw new ApiError('this category already exists', 409);
    tx.insert(taxonomy).values(row).run();
    logEvent(tx, actor, { type: 'taxonomy.changed', summary: `Категория ошибок «${row.label}» добавлена`, data: { criterionId: row.criterionId } });
  });
  return TaxonomyItemSchema.parse({ ...row, criterionId: row.criterionId ?? undefined });
}

const toTag = (r: typeof tags.$inferSelect): Tag => TagSchema.parse({ ...r, criterionId: r.criterionId ?? undefined, label: r.label ?? undefined });

export function listTags(db: Db, actor: Actor | undefined): Tag[] {
  const scope = scopeOf(db, actor);
  const rows = db.select().from(tags).orderBy(asc(tags.at)).all();
  return (scope === null ? rows : rows.filter((r) => canSee(scope, { operatorId: operatorOf(db, r.conversationId) }))).map(toTag);
}

/** Tags describe why a grade was lost; they never change a grade. */
export function addTag(db: Db, input: AddTagInput, actor?: Actor): Tag {
  const ev = db.select().from(evaluations).where(eq(evaluations.id, input.evaluationId)).get();
  if (!ev) throw new ApiError('evaluation not found', 404);
  requireVisible(db, ev.conversationId, actor);
  return db.transaction((tx) => {
    // `label` is the category. Free text only while no taxonomy is defined; then it must be one of its items.
    if (input.label !== undefined) {
      const labels = tx.select({ label: taxonomy.label }).from(taxonomy).all().map((t) => t.label);
      if (labels.length && !labels.includes(input.label)) throw new ApiError('tag is not in the taxonomy', 400);
    }
    const row = { id: `tag-${randomUUID()}`, evaluationId: ev.id, conversationId: ev.conversationId, criterionId: input.criterionId ?? null, origin: input.origin, label: input.label ?? null, by: actor?.name || 'система', at: new Date().toISOString() };
    tx.insert(tags).values(row).run();
    logEvent(tx, actor, { type: 'tag.added', conversationId: ev.conversationId, summary: `Причина ошибки: ${input.label ?? input.origin}`, data: { criterionId: input.criterionId, origin: input.origin, label: input.label } });
    return toTag(row);
  });
}

// ---------- timeline ----------

const toTimeline = (r: typeof timelineEvents.$inferSelect): TimelineEvent => TimelineEventSchema.parse({ ...r, note: r.note ?? undefined });
export const listTimeline = (db: Db): TimelineEvent[] => db.select().from(timelineEvents).orderBy(asc(timelineEvents.date)).all().map(toTimeline);

export function addTimelineEvent(db: Db, input: SaveTimelineEventInput, actor?: Actor): TimelineEvent {
  const row = { id: `tl-${randomUUID()}`, date: input.date, title: input.title, kind: input.kind, note: input.note ?? null, participantIds: input.participantIds, comparisonIds: input.comparisonIds, createdBy: actor?.name || 'система', createdAt: new Date().toISOString() };
  db.transaction((tx) => {
    tx.insert(timelineEvents).values(row).run();
    logEvent(tx, actor, { type: 'timeline.added', summary: `Событие на шкале: ${row.title} (${row.date})`, data: { kind: row.kind, participants: row.participantIds.length, comparison: row.comparisonIds.length } });
  });
  return toTimeline(row);
}

// ---------- tasks and cross-checks ----------

const toTask = (r: typeof tasks.$inferSelect): Task => TaskSchema.parse({ ...r, doneAt: r.doneAt ?? undefined, firstReviewerId: r.firstReviewerId ?? undefined });

/** Own tasks; a top manager sees all. */
export function listTasks(db: Db, actor: Actor | undefined): Task[] {
  const rows = db.select().from(tasks).orderBy(asc(tasks.createdAt)).all();
  return rows.filter((r) => !actor || can(actor, 'task') || r.assigneeId === actor.id).map(toTask);
}

const openLoad = (db: Db, personId: string) => db.select().from(tasks).where(and(eq(tasks.assigneeId, personId), eq(tasks.status, 'open'))).all().length;

/** The eligible QA person with the fewest open tasks; ties go to the lower id so the choice is stable. */
function leastLoaded(db: Db, eligible: string[]): string | undefined {
  return [...eligible].sort((a, b) => openLoad(db, a) - openLoad(db, b) || a.localeCompare(b))[0];
}

export function createTasks(db: Db, input: CreateTasksInput, actor?: Actor): Task[] {
  const qa = db.select().from(people).where(eq(people.role, 'reviewer')).all().map((p) => p.id);
  const assignable = new Set([...qa, ...db.select().from(people).where(eq(people.role, 'lead')).all().map((p) => p.id)]);
  if (input.assigneeId && !assignable.has(input.assigneeId)) throw new ApiError('the assignee must be a QA person or a top manager', 400);
  return db.transaction((tx) => {
    const created: Task[] = [];
    const skipped: string[] = [];
    for (const conversationId of [...new Set(input.conversationIds)]) {
      if (!conversationExists(db, conversationId)) throw new ApiError(`conversation ${conversationId} not found`, 404);
      // Already waiting for someone: skipped, so a batch over a mixed selection still hands out the rest.
      if (tx.select().from(tasks).where(and(eq(tasks.conversationId, conversationId), eq(tasks.kind, input.kind), eq(tasks.status, 'open'))).get()) {
        skipped.push(conversationId);
        continue;
      }
      const review = tx.select().from(reviews).where(eq(reviews.conversationId, conversationId)).get();
      if (input.kind === 'crosscheck' && review?.status !== 'reviewed') throw new ApiError(`dialog ${conversationId} must be reviewed before a cross-check`, 409);
      const first = input.kind === 'crosscheck' ? review?.byId ?? undefined : undefined;
      const assigneeId = input.assigneeId ?? leastLoaded(db, qa.filter((id) => id !== first));
      if (!assigneeId) throw new ApiError('no QA person available for this task', 409);
      if (first && assigneeId === first) throw new ApiError('a cross-check cannot go to the person who reviewed the dialog', 409);
      const row = { id: `task-${randomUUID()}`, conversationId, assigneeId, kind: input.kind, status: 'open', auto: !input.assigneeId, createdBy: actor?.name || 'система', createdAt: new Date().toISOString(), doneAt: null, firstReviewerId: first ?? null };
      tx.insert(tasks).values(row).run();
      logEvent(tx, actor, { type: 'task.created', conversationId, summary: `${input.kind === 'crosscheck' ? 'Контрольная проверка' : 'Проверка'} поручена${row.auto ? ' автоматически (по загрузке)' : ''}`, data: { taskId: row.id, kind: input.kind, assigneeId, auto: row.auto } });
      notify(tx, [assigneeId], { kind: 'task', title: input.kind === 'crosscheck' ? `Контрольная проверка: ${conversationId}` : `Новая задача: ${conversationId}`, body: 'Вам назначена проверка диалога.', conversationId });
      created.push(toTask(row));
    }
    // Nothing new at all is a conflict, not a silent success. The web matches 'already has an open task'.
    if (!created.length && skipped.length) throw new ApiError(`${skipped.length === 1 ? `dialog ${skipped[0]}` : `each of the ${skipped.length} dialogs`} already has an open task of this kind`, 409);
    return created;
  });
}

/** A random sample of reviewed dialogs that were never cross-checked goes to a second QA person, chosen by load. */
export function sampleCrosschecks(db: Db, percent: number, actor?: Actor): Task[] {
  const done = new Set(db.select({ c: tasks.conversationId }).from(tasks).where(eq(tasks.kind, 'crosscheck')).all().map((r) => r.c));
  const pool = db.select({ c: reviews.conversationId }).from(reviews).where(eq(reviews.status, 'reviewed')).all().map((r) => r.c).filter((c) => !done.has(c));
  const n = Math.min(pool.length, Math.ceil((pool.length * percent) / 100));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const out: Task[] = [];
  for (const conversationId of pool.slice(0, n)) {
    try {
      out.push(...createTasks(db, { conversationIds: [conversationId], kind: 'crosscheck' }, actor));
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 409) throw e; // no second QA person for this dialog: skip it
    }
  }
  return out;
}

const toCrosscheck = (r: typeof crosschecks.$inferSelect): Crosscheck => CrosscheckSchema.parse({ ...r, reviewerId: r.reviewerId ?? undefined });

/**
 * A QA person sees only their own cross-checks (blind: not each other's); a manager those on their team's dialogs;
 * top managers and admins see all.
 */
export function listCrosschecks(db: Db, actor: Actor | undefined): Crosscheck[] {
  const rows = db.select().from(crosschecks).orderBy(asc(crosschecks.submittedAt)).all();
  const scope = actor?.role === 'manager' ? scopeOf(db, actor) : undefined;
  return rows.filter((r) => !actor || can(actor, 'task') || can(actor, 'audit') || r.reviewerId === actor.id || (scope !== undefined && canSee(scope, { operatorId: operatorOf(db, r.conversationId) }))).map(toCrosscheck);
}

export function submitCrosscheck(db: Db, input: SubmitCrosscheckInput, actor?: Actor): Crosscheck {
  return db.transaction((tx) => {
    const task = tx.select().from(tasks).where(eq(tasks.id, input.taskId)).get();
    if (!task || task.kind !== 'crosscheck') throw new ApiError('cross-check task not found', 404);
    if (actor && task.assigneeId !== actor.id) throw new ApiError('this cross-check is assigned to someone else', 403);
    if (task.status !== 'open') throw new ApiError(`task is already ${task.status}`, 409);
    const ev = latestEvaluation(db, task.conversationId);
    if (!ev || ev.status !== 'completed') throw new ApiError('the dialog has no completed evaluation', 409);
    const checklist = getChecklist(db, ev.checklistVersionId);
    for (const r of input.results) {
      const c = checklist?.criteria.find((x) => x.id === r.criterionId);
      if (!c) throw new ApiError(`criterion ${r.criterionId} is not part of this evaluation`, 400);
      if (r.isNA ? !c.allowNA : r.value === null || !c.allowedValues.includes(r.value)) throw new ApiError(`value is not allowed for criterion ${r.criterionId}`, 400);
    }
    const now = new Date().toISOString();
    const row = { id: `cc-${randomUUID()}`, taskId: task.id, conversationId: task.conversationId, evaluationId: ev.id, reviewerId: actor?.id ?? null, reviewerName: actor?.name || 'система', reviewerRole: actor?.role ?? 'reviewer', results: input.results, submittedAt: now };
    tx.insert(crosschecks).values(row).run();
    tx.update(tasks).set({ status: 'done', doneAt: now }).where(eq(tasks.id, task.id)).run();
    logEvent(tx, actor, { type: 'crosscheck.submitted', conversationId: task.conversationId, summary: 'Контрольная проверка выполнена', data: { taskId: task.id, evaluationId: ev.id } });
    return toCrosscheck(row);
  });
}

/** Marks a task done without work (cancelled by the creator): kept so the log stays complete. */
export function cancelTask(db: Db, id: string, actor?: Actor): Task {
  return db.transaction((tx) => {
    const t = tx.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!t) throw new ApiError('task not found', 404);
    if (t.status !== 'open') throw new ApiError(`task is already ${t.status}`, 409);
    tx.update(tasks).set({ status: 'cancelled', doneAt: new Date().toISOString() }).where(eq(tasks.id, id)).run();
    logEvent(tx, actor, { type: 'task.done', conversationId: t.conversationId, summary: 'Задача отменена', data: { taskId: id, cancelled: true } });
    return toTask({ ...t, status: 'cancelled' });
  });
}
