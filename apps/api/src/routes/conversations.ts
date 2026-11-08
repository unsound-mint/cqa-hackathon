import { AssignOperatorInputSchema, ListConversationsQuerySchema, SetReviewInputSchema } from '@cqa/contracts';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import { getConversation, getConversationView, listConversationViews } from '../services/conversations.js';
import { ApiError } from '../services/errors.js';
import { assignOperator, setReview } from '../services/review.js';
import { actorOf, denied } from './actor.js';
import { AudioError, downloadAudio, hasLocalAudio, resolveAudio, sendLocalAudio, type AudioStore } from '../services/audio.js';

export function conversationRoutes(app: FastifyInstance, db: Db, audio: AudioStore) {
  app.get('/api/conversations', async (req, reply) => {
    const q = ListConversationsQuerySchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid query' });
    return listConversationViews(db, q.data, actorOf(req));
  });

  app.get<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    return getConversationView(db, req.params.id, actorOf(req)) ?? reply.code(404).send({ error: 'conversation not found' });
  });

  /** Mark a dialog in review / reviewed, or `new` to reopen it. Bound to the latest evaluation. */
  app.post<{ Params: { id: string } }>('/api/conversations/:id/review', async (req, reply) => {
    if (denied(req, reply, 'review')) return;
    const body = SetReviewInputSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'body must be { status: new | in_review | reviewed }' });
    try {
      setReview(db, req.params.id, body.data, actorOf(req));
    } catch (e) {
      if (e instanceof ApiError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
    return getConversationView(db, req.params.id);
  });

  /** Assign dialogs to an operator (or unassign with null). The organizer data carries no operator identity. */
  app.post('/api/conversations/operator', async (req, reply) => {
    if (denied(req, reply, 'assign')) return;
    const body = AssignOperatorInputSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'body must be { conversationIds: string[], operator: string | null }' });
    try {
      assignOperator(db, body.data, actorOf(req));
    } catch (e) {
      if (e instanceof ApiError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
    return reply.code(204).send();
  });

  /**
   * Playable recording of a call. A stored copy (data/private/audio) is served with ranges; otherwise the request is
   * redirected to the media behind the stored `audioUrl` (the organizer links a player page, not the file; see
   * services/audio.ts) while a copy is stored in the background for next time.
   */
  app.get<{ Params: { id: string } }>('/api/conversations/:id/audio', async (req, reply) => {
    const c = getConversationView(db, req.params.id, actorOf(req)) && getConversation(db, req.params.id);
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
