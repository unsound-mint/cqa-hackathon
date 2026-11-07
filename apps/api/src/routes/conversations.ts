import { ListConversationsQuerySchema } from '@cqa/contracts';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import { conversations } from '../db/schema.js';
import { getConversation, toConversation } from '../services/conversations.js';
import { AudioError, downloadAudio, hasLocalAudio, resolveAudio, sendLocalAudio, type AudioStore } from '../services/audio.js';

export function conversationRoutes(app: FastifyInstance, db: Db, audio: AudioStore) {
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
   * Playable recording of a call. A stored copy (data/private/audio) is served with ranges; otherwise the request is
   * redirected to the media behind the stored `audioUrl` (the organizer links a player page, not the file; see
   * services/audio.ts) while a copy is stored in the background for next time.
   */
  app.get<{ Params: { id: string } }>('/api/conversations/:id/audio', async (req, reply) => {
    const c = getConversation(db, req.params.id);
    if (!c) return reply.code(404).send({ error: 'conversation not found' });
    if (!c.audioUrl) return reply.code(404).send({ error: 'conversation has no recording' });
    if (hasLocalAudio(audio, c.id)) return sendLocalAudio(audio, c.id, req, reply);
    void downloadAudio(audio, c.id, c.audioUrl).catch((e: unknown) => req.log.warn({ id: c.id, err: e instanceof Error ? e.message : 'unknown' }, 'recording not stored'));
    try {
      return reply.redirect(await resolveAudio(c.audioUrl, audio.fetchFn), 302);
    } catch (e) {
      if (e instanceof AudioError) return reply.code(502).send({ error: `recording unavailable: ${e.message}` });
      throw e;
    }
  });
}
