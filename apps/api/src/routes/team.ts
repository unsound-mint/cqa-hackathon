import {
  AddCommentInputSchema, AddTagInputSchema, CreateTasksInputSchema, ListEventsQuerySchema, PersonSchema, SampleCrosschecksInputSchema,
  SaveTaxonomyItemInputSchema, SaveTimelineEventInputSchema, SubmitCrosscheckInputSchema, TeamSchema,
} from '@cqa/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { getDirectory, savePerson, saveTeam, seedDemoOrg } from '../services/directory.js';
import { listEvents } from '../services/events.js';
import { listNotifications, markRead } from '../services/notifications.js';
import {
  acknowledgeComment, addComment, addTag, addTaxonomyItem, addTimelineEvent, cancelTask, createTasks, listComments, listCrosschecks, listTags, listTasks,
  listTaxonomy, listTimeline, sampleCrosschecks, submitCrosscheck,
} from '../services/work.js';
import { actorOf, denied } from './actor.js';

const bad = (reply: FastifyReply, what: string) => reply.code(400).send({ error: `body must be ${what}` });

/** People, teams, audit log, notifications, comments, tags, tasks, cross-checks and the timeline. Roles are enforced here; scoping in the services. */
export function teamRoutes(app: FastifyInstance, db: Db) {
  // Handlers here throw ApiError / ZodError and rely on the app-wide error handler in app.ts.
  app.get('/api/directory', async () => getDirectory(db));
  app.post('/api/people', async (req, reply) => {
    if (denied(req, reply, 'manageTeams')) return;
    const b = PersonSchema.safeParse(req.body);
    return b.success ? reply.code(201).send(savePerson(db, b.data, actorOf(req))) : bad(reply, '{ id, name, role, teamId }');
  });
  app.post('/api/teams', async (req, reply) => {
    if (denied(req, reply, 'manageTeams')) return;
    const b = TeamSchema.safeParse(req.body);
    return b.success ? reply.code(201).send(saveTeam(db, b.data, actorOf(req))) : bad(reply, '{ id, name, managerId }');
  });
  /** Fictional organisation for demos (the organizer data has no people or teams). Only into an empty directory. */
  app.post('/api/demo/org', async (req, reply) => {
    if (denied(req, reply, 'manageTeams')) return;
    return reply.code(201).send(seedDemoOrg(db, actorOf(req)));
  });

  app.get('/api/events', async (req, reply) => {
    if (denied(req, reply, 'audit')) return;
    const q = ListEventsQuerySchema.safeParse(req.query);
    return q.success ? listEvents(db, q.data) : bad(reply, 'a valid query');
  });

  app.get('/api/notifications', async (req) => listNotifications(db, actorOf(req)));
  app.post('/api/notifications/read', async (req, reply) => {
    const b = z.object({ ids: z.array(z.string()).optional() }).safeParse(req.body ?? {});
    if (!b.success) return bad(reply, '{ ids?: string[] }');
    markRead(db, actorOf(req), b.data.ids);
    return reply.code(204).send();
  });

  app.get('/api/comments', async (req) => listComments(db, actorOf(req)));
  app.post('/api/comments', async (req, reply) => {
    if (denied(req, reply, 'comment')) return;
    const b = AddCommentInputSchema.safeParse(req.body);
    return b.success ? reply.code(201).send(addComment(db, b.data, actorOf(req))) : bad(reply, '{ conversationId, criterionId?, body }');
  });
  app.post<{ Params: { id: string } }>('/api/comments/:id/ack', async (req) => acknowledgeComment(db, req.params.id, actorOf(req)));

  app.get('/api/taxonomy', async () => listTaxonomy(db));
  app.post('/api/taxonomy', async (req, reply) => {
    if (denied(req, reply, 'editTaxonomy')) return;
    const b = SaveTaxonomyItemInputSchema.safeParse(req.body);
    return b.success ? reply.code(201).send(addTaxonomyItem(db, b.data, actorOf(req))) : bad(reply, '{ label, criterionId? }');
  });
  app.get('/api/tags', async (req) => listTags(db, actorOf(req)));
  app.post('/api/tags', async (req, reply) => {
    if (denied(req, reply, 'tag')) return;
    const b = AddTagInputSchema.safeParse(req.body);
    return b.success ? reply.code(201).send(addTag(db, b.data, actorOf(req))) : bad(reply, '{ evaluationId, criterionId?, origin, label? }');
  });

  app.get('/api/timeline', async () => listTimeline(db));
  app.post('/api/timeline', async (req, reply) => {
    if (denied(req, reply, 'timeline')) return;
    const b = SaveTimelineEventInputSchema.safeParse(req.body);
    return b.success ? reply.code(201).send(addTimelineEvent(db, b.data, actorOf(req))) : bad(reply, '{ date, title, kind, participantIds, comparisonIds }');
  });

  app.get('/api/tasks', async (req) => listTasks(db, actorOf(req)));
  app.post('/api/tasks', async (req, reply) => {
    if (denied(req, reply, 'task')) return;
    const b = CreateTasksInputSchema.safeParse(req.body);
    return b.success ? reply.code(201).send(createTasks(db, b.data, actorOf(req))) : bad(reply, '{ conversationIds, kind, assigneeId? }');
  });
  app.post('/api/tasks/sample', async (req, reply) => {
    if (denied(req, reply, 'task')) return;
    const b = SampleCrosschecksInputSchema.safeParse(req.body);
    return b.success ? reply.code(201).send(sampleCrosschecks(db, b.data.percent, actorOf(req))) : bad(reply, '{ percent: 1..100 }');
  });
  app.post<{ Params: { id: string } }>('/api/tasks/:id/cancel', async (req, reply) => (denied(req, reply, 'task') ? undefined : cancelTask(db, req.params.id, actorOf(req))));

  app.get('/api/crosschecks', async (req) => listCrosschecks(db, actorOf(req)));
  app.post('/api/crosschecks', async (req, reply) => {
    if (denied(req, reply, 'crosscheck')) return;
    const b = SubmitCrosscheckInputSchema.safeParse(req.body);
    return b.success ? reply.code(201).send(submitCrosscheck(db, b.data, actorOf(req))) : bad(reply, '{ taskId, results }');
  });
}
