import { ListConversationsQuerySchema } from '@cqa/contracts';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import { conversations } from '../db/schema.js';
import { getConversation, toConversation } from '../services/conversations.js';
import { AudioError, resolveAudio, type FetchLike } from '../services/audio.js';

export function conversationRoutes(app: FastifyInstance, db: Db, audioFetch?: FetchLike) {
  app.get('/api/conversations', async (req, reply) => {
    const q = ListConversationsQuerySchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid query' });
    const where = and(q.data.language ? eq(conversations.language, q.data.language) : undefined, q.data.channel ? eq(conversations.channel, q.data.channel) : undefined);
    return db.select().from(conversations).where(where).orderBy(asc(conversations.id)).all().map(toConversation);
  });

  app.get<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    return getConversation(db, req.params.id) ?? reply.code(404).send({ error: 'conversation not found' });
  });

  /**
   * Playable recording of a call: redirects to the media behind the stored `audioUrl` (the organizer links a player
   * page, not the file; see services/audio.ts). The <audio> element follows the redirect and range-requests the host.
   */
  app.get<{ Params: { id: string } }>('/api/conversations/:id/audio', async (req, reply) => {
    const c = getConversation(db, req.params.id);
    if (!c) return reply.code(404).send({ error: 'conversation not found' });
    if (!c.audioUrl) return reply.code(404).send({ error: 'conversation has no recording' });
    try {
      return reply.redirect(await resolveAudio(c.audioUrl, audioFetch), 302);
    } catch (e) {
      if (e instanceof AudioError) return reply.code(502).send({ error: `recording unavailable: ${e.message}` });
      throw e;
    }
  });
}
