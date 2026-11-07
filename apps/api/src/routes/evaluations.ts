import { CreateAppealInputSchema, DecideAppealInputSchema, ListAppealsQuerySchema, ListEvaluationsQuerySchema, StartEvaluationInputSchema } from '@cqa/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Db } from '../db/index.js';
import { AppealError, createAppeal, decideAppeal, listAllAppeals, listAppeals } from '../services/appeals.js';
import { getEvaluation, listEvaluations } from '../services/evaluations.js';
import { JobError, type JobRunner } from '../services/evaluation/jobs.js';

function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof AppealError) return reply.code(e.status).send({ error: e.message });
  throw e;
}

export function evaluationRoutes(app: FastifyInstance, db: Db, runner: JobRunner) {
  app.get('/api/evaluations', async (req, reply) => {
    const q = ListEvaluationsQuerySchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid query' });
    return listEvaluations(db, q.data.conversationId);
  });

  app.post('/api/evaluations', async (req, reply) => {
    const body = StartEvaluationInputSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'body must be { conversationIds: string[], checklistVersionId: string }' });
    try {
      return reply.code(202).send({ jobId: runner.start(body.data).id });
    } catch (e) {
      if (e instanceof JobError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (req, reply) => runner.getJob(req.params.id) ?? reply.code(404).send({ error: 'job not found' }));

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

  /** Approver's queue: appeals across all dialogs, e.g. `?status=pending`. */
  app.get('/api/appeals', async (req, reply) => {
    const q = ListAppealsQuerySchema.omit({ evaluationId: true }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'status must be pending, upheld or overridden' });
    return listAllAppeals(db, q.data.status);
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
