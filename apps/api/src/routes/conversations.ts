import { ListConversationsQuerySchema } from '@cqa/contracts';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import { conversations } from '../db/schema.js';
import { getConversation, toConversation } from '../services/conversations.js';

export function conversationRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/conversations', async (req, reply) => {
    const q = ListConversationsQuerySchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid query' });
    const where = and(q.data.language ? eq(conversations.language, q.data.language) : undefined, q.data.channel ? eq(conversations.channel, q.data.channel) : undefined);
    return db.select().from(conversations).where(where).orderBy(asc(conversations.id)).all().map(toConversation);
  });

  app.get<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    return getConversation(db, req.params.id) ?? reply.code(404).send({ error: 'conversation not found' });
  });
}
