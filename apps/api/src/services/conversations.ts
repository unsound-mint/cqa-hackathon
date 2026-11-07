import { ConversationSchema, type Conversation } from '@cqa/contracts';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { conversations } from '../db/schema.js';

export function toConversation(row: typeof conversations.$inferSelect): Conversation {
  return ConversationSchema.parse(row);
}

export function getConversation(db: Db, id: string): Conversation | undefined {
  const row = db.select().from(conversations).where(eq(conversations.id, id)).get();
  return row ? toConversation(row) : undefined;
}
