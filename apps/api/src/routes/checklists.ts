import { SaveChecklistInputSchema } from '@cqa/contracts';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import { getChecklist, listChecklists, saveChecklistVersion } from '../services/checklists.js';

export function checklistRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/checklists', async () => listChecklists(db));

  app.get<{ Params: { id: string } }>('/api/checklists/:id', async (req, reply) => getChecklist(db, req.params.id) ?? reply.code(404).send({ error: 'checklist not found' }));

  app.post('/api/checklists', async (req, reply) => {
    const body = SaveChecklistInputSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid checklist', issues: body.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    return reply.code(201).send(saveChecklistVersion(db, body.data));
  });
}
