import { CreateAppealInputSchema, DecideAppealInputSchema, ListAppealsQuerySchema, ListEvaluationsQuerySchema, OverrideCriterionInputSchema, StartEvaluationInputSchema } from '@cqa/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Db } from '../db/index.js';
import { createAppeal, decideAppeal, evaluationVisible, listAllAppeals, listAppeals, overrideCriterion } from '../services/appeals.js';
import { ApiError } from '../services/errors.js';
import { logEvent } from '../services/events.js';
import { scopeOf } from '../services/directory.js';
import { listConversationViews } from '../services/conversations.js';
import { actorOf, denied } from './actor.js';
import { getEvaluation, listEvaluations } from '../services/evaluations.js';
import { JobError, type JobRunner } from '../services/evaluation/jobs.js';

function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof ApiError) return reply.code(e.status).send({ error: e.message });
  throw e;
}

export function evaluationRoutes(app: FastifyInstance, db: Db, runner: JobRunner) {
  app.get('/api/evaluations', async (req, reply) => {
    const q = ListEvaluationsQuerySchema.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid query' });
    const actor = actorOf(req);
    const list = listEvaluations(db, q.data.conversationId);
    if (scopeOf(db, actor) === null) return list;
    const mine = new Set(listConversationViews(db, {}, actor).map((c) => c.id));
    return list.filter((e) => mine.has(e.conversationId));
  });

  app.post('/api/evaluations', async (req, reply) => {
    if (denied(req, reply, 'evaluate')) return;
    const body = StartEvaluationInputSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'body must be { conversationIds: string[], checklistVersionId: string }' });
    try {
      const job = runner.start(body.data);
      logEvent(db, actorOf(req), { type: 'evaluation.started', summary: `Запущена оценка диалогов: ${body.data.conversationIds.length}`, data: { jobId: job.id, count: body.data.conversationIds.length, checklistVersionId: body.data.checklistVersionId, force: !!(body.data.force || body.data.fresh) } });
      return reply.code(202).send({ jobId: job.id });
    } catch (e) {
      if (e instanceof JobError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (req, reply) => runner.getJob(req.params.id) ?? reply.code(404).send({ error: 'job not found' }));

  app.get<{ Params: { id: string } }>('/api/evaluations/:id', async (req, reply) => (evaluationVisible(db, req.params.id, actorOf(req)) && getEvaluation(db, req.params.id)) || reply.code(404).send({ error: 'evaluation not found' }));

  app.get<{ Params: { id: string } }>('/api/evaluations/:id/appeals', async (req, reply) =>
    getEvaluation(db, req.params.id) && evaluationVisible(db, req.params.id, actorOf(req)) ? listAppeals(db, req.params.id) : reply.code(404).send({ error: 'evaluation not found' }),
  );

  app.post<{ Params: { id: string } }>('/api/evaluations/:id/appeals', async (req, reply) => {
    if (denied(req, reply, 'appeal')) return;
    const body = CreateAppealInputSchema.omit({ evaluationId: true }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'body must be { criterionId, comment }' });
    try {
      return reply.code(201).send(createAppeal(db, { ...body.data, evaluationId: req.params.id }, actorOf(req)));
    } catch (e) {
      return fail(reply, e);
    }
  });

  /** A reviewer changes one criterion directly; answers the recorded correction. */
  app.post<{ Params: { id: string } }>('/api/evaluations/:id/overrides', async (req, reply) => {
    if (denied(req, reply, 'correct')) return;
    const body = OverrideCriterionInputSchema.safeParse({ ...(req.body as object | null), evaluationId: req.params.id });
    if (!body.success) return reply.code(400).send({ error: 'invalid override', issues: body.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    try {
      return reply.code(201).send(overrideCriterion(db, body.data, actorOf(req)));
    } catch (e) {
      return fail(reply, e);
    }
  });

  /** Approver's queue: appeals across all dialogs, e.g. `?status=pending`. */
  app.get('/api/appeals', async (req, reply) => {
    const q = ListAppealsQuerySchema.omit({ evaluationId: true }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'status must be pending, upheld or overridden' });
    return listAllAppeals(db, q.data.status, actorOf(req));
  });

  app.post<{ Params: { id: string } }>('/api/appeals/:id/decision', async (req, reply) => {
    if (denied(req, reply, 'decide')) return;
    const body = DecideAppealInputSchema.safeParse({ ...(req.body as object | null), appealId: req.params.id });
    if (!body.success) return reply.code(400).send({ error: 'invalid decision', issues: body.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    try {
      return decideAppeal(db, body.data, actorOf(req));
    } catch (e) {
      return fail(reply, e);
    }
  });
}
