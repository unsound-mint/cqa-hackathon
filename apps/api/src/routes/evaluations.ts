import { CreateAppealInputSchema, DecideAppealInputSchema, ListEvaluationsQuerySchema } from '@cqa/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Db } from '../db/index.js';
import { AppealError, createAppeal, decideAppeal, listAppeals } from '../services/appeals.js';
import { getEvaluation, listEvaluations } from '../services/evaluations.js';

function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof AppealError) return reply.code(e.status).send({ error: e.message });
  throw e;
}

export function evaluationRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/evaluations', async (req, reply) => {
    const q = ListEvaluationsQuerySchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid query' });
    return listEvaluations(db, q.data.conversationId);
  });

  app.get<{ Params: { id: string } }>('/api/evaluations/:id', async (req, reply) => getEvaluation(db, req.params.id) ?? reply.code(404).send({ error: 'evaluation not found' }));

  app.get<{ Params: { id: string } }>('/api/evaluations/:id/appeals', async (req, reply) =>
    getEvaluation(db, req.params.id) ? listAppeals(db, req.params.id) : reply.code(404).send({ error: 'evaluation not found' }),
  );

  app.post<{ Params: { id: string } }>('/api/evaluations/:id/appeals', async (req, reply) => {
    const body = CreateAppealInputSchema.omit({ evaluationId: true }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'body must be { criterionId, comment }' });
    try {
      return reply.code(201).send(createAppeal(db, { ...body.data, evaluationId: req.params.id }));
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post<{ Params: { id: string } }>('/api/appeals/:id/decision', async (req, reply) => {
    const body = DecideAppealInputSchema.safeParse({ ...(req.body as object | null), appealId: req.params.id });
    if (!body.success) return reply.code(400).send({ error: 'invalid decision', issues: body.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    try {
      return decideAppeal(db, body.data);
    } catch (e) {
      return fail(reply, e);
    }
  });
}
