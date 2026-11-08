import { NotificationSchema, type Actor, type Evaluation, type Notification } from '@cqa/contracts';
import { desc, eq, inArray, and, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import { notifications, people } from '../db/schema.js';
import { getChecklist } from './checklists.js';
import { responsibleFor } from './directory.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function notify(db: Db | Tx, recipientIds: string[], n: { kind: Notification['kind']; title: string; body: string; conversationId?: string; criterionId?: string }): void {
  const at = new Date().toISOString();
  for (const recipientId of new Set(recipientIds)) {
    db.insert(notifications).values({ id: `n-${randomUUID()}`, at, recipientId, kind: n.kind, title: n.title, body: n.body, conversationId: n.conversationId ?? null, criterionId: n.criterionId ?? null }).run();
  }
}

/** Notifications of the acting person, newest first. A call without a person id has none. */
export function listNotifications(db: Db, actor: Actor | undefined): Notification[] {
  if (!actor?.id) return [];
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.recipientId, actor.id))
    .orderBy(desc(notifications.at), desc(notifications.id))
    .limit(200)
    .all()
    .map((r) => NotificationSchema.parse({ ...r, conversationId: r.conversationId ?? undefined, criterionId: r.criterionId ?? undefined, readAt: r.readAt ?? undefined }));
}

export function markRead(db: Db, actor: Actor | undefined, ids?: string[]): void {
  if (!actor?.id) return;
  const where = and(eq(notifications.recipientId, actor.id), isNull(notifications.readAt), ids ? inArray(notifications.id, ids) : undefined);
  db.update(notifications).set({ readAt: new Date().toISOString() }).where(where).run();
}

/**
 * A serious violation on a finished evaluation tells the manager of the operator's team and the top managers. The
 * trigger is the checklist's own critical flag, never a criterion id, so it follows whatever the checklist defines.
 * Called when an evaluation is stored, when a correction or appeal decision newly raises a flag, and as a backfill
 * when the demo organisation is seeded (the dialogs had no manager before).
 */
export function notifyCritical(db: Db, e: Evaluation, opts: { tx?: Tx; once?: boolean } = {}): void {
  if (e.status !== 'completed' || !e.seriousViolation) return;
  const w = opts.tx ?? db;
  const checklist = getChecklist(db, e.checklistVersionId);
  const raised = e.finalResults.filter((r) => r.value === true && checklist?.criteria.find((c) => c.id === r.criterionId)?.criticalFlag).map((r) => checklist?.criteria.find((c) => c.id === r.criterionId)?.title ?? r.criterionId);
  const { managerId } = responsibleFor(db, e.conversationId);
  const leads = w.select({ id: people.id }).from(people).where(eq(people.role, 'lead')).all().map((p) => p.id);
  let to = [...(managerId ? [managerId] : []), ...leads];
  // `once`: a backfill must not repeat an alert the person already has for this dialog.
  if (opts.once) to = to.filter((id) => !w.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.recipientId, id), eq(notifications.kind, 'critical'), eq(notifications.conversationId, e.conversationId))).get());
  if (to.length) notify(w, to, { kind: 'critical', title: `Грубое нарушение: ${e.conversationId}`, body: raised.length ? raised.join('; ') : 'Выявлено грубое нарушение.', conversationId: e.conversationId });
}
