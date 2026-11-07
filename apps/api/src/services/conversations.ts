import { ConversationSchema, canSee, type Actor, type Conversation, type ListConversationsQuery } from '@cqa/contracts';
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { conversations, operatorAssignments, reviews } from '../db/schema.js';
import { scopeOf } from './directory.js';

type Row = typeof conversations.$inferSelect;

/**
 * The stored source only: transcript, roles, audio. The evaluator and its reuse cache hash this object, so it must
 * not change when an operator is assigned or a dialog is reviewed. Routes use `getConversationView` instead.
 */
export function toConversation(row: Row): Conversation {
  const { importedAt: _i, ...source } = row;
  return ConversationSchema.parse(source);
}

export function getConversation(db: Db, id: string): Conversation | undefined {
  const row = db.select().from(conversations).where(eq(conversations.id, id)).get();
  return row ? toConversation(row) : undefined;
}

function enrich(row: Row, operator: string | undefined, review: typeof reviews.$inferSelect | undefined): Conversation {
  return ConversationSchema.parse({
    ...row,
    operatorId: operator ?? null,
    ...(review ? { review: { status: review.status, evaluationId: review.evaluationId, by: review.by, at: review.at } } : {}),
  });
}

/** What the UI sees: the source plus import time, assigned operator and review. Scoped to what the actor may see. */
export function listConversationViews(db: Db, q: ListConversationsQuery = {}, actor?: Actor): Conversation[] {
  const where = and(q.language ? eq(conversations.language, q.language) : undefined, q.channel ? eq(conversations.channel, q.channel) : undefined);
  const ops = new Map(db.select().from(operatorAssignments).all().map((a) => [a.conversationId, a.operator]));
  const revs = new Map(db.select().from(reviews).all().map((r) => [r.conversationId, r]));
  const scope = scopeOf(db, actor);
  return db
    .select()
    .from(conversations)
    .where(where)
    .orderBy(asc(conversations.id))
    .all()
    .map((row) => enrich(row, ops.get(row.id), revs.get(row.id)))
    .filter((c) => canSee(scope, c));
}

export function getConversationView(db: Db, id: string, actor?: Actor): Conversation | undefined {
  const row = db.select().from(conversations).where(eq(conversations.id, id)).get();
  if (!row) return undefined;
  const view = enrich(row, db.select().from(operatorAssignments).where(eq(operatorAssignments.conversationId, id)).get()?.operator, db.select().from(reviews).where(eq(reviews.conversationId, id)).get());
  return canSee(scopeOf(db, actor), view) ? view : undefined;
}
