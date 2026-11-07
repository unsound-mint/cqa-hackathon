import { SaveChecklistInputSchema } from '@cqa/contracts';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import { isKnownDetector, listDetectors } from '../services/evaluation/detectors/index.js';
import { actorOf, denied } from './actor.js';
import { logEvent } from '../services/events.js';
import { getChecklist, listChecklists, saveChecklistVersion } from '../services/checklists.js';

export function checklistRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/checklists', async () => listChecklists(db));

  /** Rules a criterion may name in `detector` (UI: "check by rule" option). */
  app.get('/api/detectors', async () => listDetectors());

  app.get<{ Params: { id: string } }>('/api/checklists/:id', async (req, reply) => getChecklist(db, req.params.id) ?? reply.code(404).send({ error: 'checklist not found' }));

  app.post('/api/checklists', async (req, reply) => {
    if (denied(req, reply, 'editChecklist')) return;
    const body = SaveChecklistInputSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid checklist', issues: body.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    const unknown = body.data.criteria.filter((c) => c.detector && !isKnownDetector(c.detector)).map((c) => `${c.id}: unknown detector ${c.detector}`);
    if (unknown.length) return reply.code(400).send({ error: 'invalid checklist', issues: unknown.map((message) => ({ path: 'criteria', message })) });
    const saved = saveChecklistVersion(db, body.data);
    logEvent(db, actorOf(req), { type: 'checklist.saved', summary: `Сохранена версия чек-листа ${saved.version}: критериев ${saved.criteria.length}`, data: { version: saved.version, criteria: saved.criteria.length } });
    return reply.code(201).send(saved);
  });
}
