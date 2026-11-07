import { EventSchema, type Actor, type AuditEvent, type EventType, type ListEventsQuery } from '@cqa/contracts';
import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import { events } from '../db/schema.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Appends one row to the audit log. Called inside the transaction of the action it records, so the two never disagree. */
export function logEvent(db: Db | Tx, actor: Actor | undefined, e: { type: EventType; summary: string; conversationId?: string; data?: Record<string, unknown> }): void {
  db.insert(events)
    .values({
      id: `ev-${randomUUID()}`,
      at: new Date().toISOString(),
      actorId: actor?.id ?? null,
      actorName: actor?.name || (actor ? 'без имени' : 'система'),
      actorRole: actor?.role ?? null,
      type: e.type,
      conversationId: e.conversationId ?? null,
      summary: e.summary,
      data: e.data ?? null,
    })
    .run();
}

/** Newest first. */
export function listEvents(db: Db, q: ListEventsQuery = {}): AuditEvent[] {
  const where = and(q.type ? eq(events.type, q.type) : undefined, q.actorId ? eq(events.actorId, q.actorId) : undefined, q.conversationId ? eq(events.conversationId, q.conversationId) : undefined);
  return db
    .select()
    .from(events)
    .where(where)
    .orderBy(desc(events.at), desc(events.id))
    .limit(q.limit ?? 1000)
    .all()
    .map((r) => EventSchema.parse({ ...r, actorId: r.actorId ?? undefined, actorRole: r.actorRole ?? undefined, conversationId: r.conversationId ?? undefined, data: r.data ?? undefined }));
}
