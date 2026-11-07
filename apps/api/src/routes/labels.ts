import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compare, formatReport } from '@cqa/evaluation';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Db } from '../db/index.js';
import { clearLabel, labelProgress, labelsCsv, LabelError, LabelInputSchema, listLabels, saveLabel } from '../services/labels.js';
import { getChecklist, listChecklists } from '../services/checklists.js';
import { getConversation } from '../services/conversations.js';
import { listEvaluations } from '../services/evaluations.js';
import { conversations as conversationsTable } from '../db/schema.js';
import { ConversationSchema } from '@cqa/contracts';
import { asc } from 'drizzle-orm';

// Works from both src/routes/ (dev, tests) and dist/ (built): the first candidate that exists wins.
const PAGE_CANDIDATES = ['../../static/label.html', '../static/label.html'].map((p) => fileURLToPath(new URL(p, import.meta.url)));
const readPage = () => {
  const path = PAGE_CANDIDATES.find((p) => existsSync(p));
  return path ? readFileSync(path, 'utf8') : '<!doctype html><title>label</title><p>label page not found</p>';
};

function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof LabelError) return reply.code(e.status).send({ error: e.message });
  throw e;
}

/**
 * Human labeling for the validation owner. Labels are private reference data: nothing in the evaluator reads
 * them (a test guards this). The page never shows model results, so labels stay independent of them.
 */
export function labelRoutes(app: FastifyInstance, db: Db) {
  /** Labels always use the first (original) checklist version, i.e. the organizer's rubric. */
  const labelChecklist = () => listChecklists(db)[0]!;

  app.get('/label', async (_req, reply) => reply.type('text/html; charset=utf-8').send(readPage()));

  app.get<{ Querystring: { conversationId?: string } }>('/api/labels', async (req) => listLabels(db, req.query.conversationId));
  app.get('/api/labels/progress', async () => labelProgress(db, labelChecklist()));

  app.put<{ Params: { conversationId: string; criterionId: string } }>('/api/labels/:conversationId/:criterionId', async (req, reply) => {
    const conversation = getConversation(db, req.params.conversationId);
    if (!conversation) return reply.code(404).send({ error: 'conversation not found' });
    const body = LabelInputSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid label', issues: body.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    try {
      return saveLabel(db, labelChecklist(), conversation, req.params.criterionId, body.data);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.delete<{ Params: { conversationId: string; criterionId: string } }>('/api/labels/:conversationId/:criterionId', async (req, reply) => {
    clearLabel(db, req.params.conversationId, req.params.criterionId);
    return reply.code(204).send();
  });

  app.get('/api/labels.csv', async (_req, reply) => {
    const all = db.select().from(conversationsTable).orderBy(asc(conversationsTable.id)).all().map((r) => ConversationSchema.parse(r));
    return reply.type('text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="annotations.csv"').send('﻿' + labelsCsv(db, all));
  });

  app.get<{ Querystring: { checklistVersionId?: string; final?: string; text?: string } }>('/api/validation/report', async (req, reply) => {
    const evaluations = listEvaluations(db);
    const counts = new Map<string, number>();
    for (const e of evaluations) counts.set(e.checklistVersionId, (counts.get(e.checklistVersionId) ?? 0) + 1);
    const id = req.query.checklistVersionId ?? [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? labelChecklist().id;
    const checklist = getChecklist(db, id);
    if (!checklist) return reply.code(404).send({ error: 'checklist not found' });
    const all = db.select().from(conversationsTable).all().map((r) => ConversationSchema.parse(r));
    const report = compare({ checklist, labels: listLabels(db), blanks: [], conversations: all, evaluations, useFinal: req.query.final === '1' });
    return { report, markdown: formatReport(report, { includeText: req.query.text === '1' }) };
  });
}
