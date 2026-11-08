import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { ImportError, importDataset, type ImportDeps } from '../services/import/importer.js';
import { prefetchAudio, type AudioStore } from '../services/audio.js';
import { actorOf, denied } from './actor.js';
import { logEvent } from '../services/events.js';
import { conversations } from '../db/schema.js';

const BodySchema = z.object({ groupId: z.string() });

export function datasetRoutes(app: FastifyInstance, db: Db, deps: ImportDeps, audio?: AudioStore) {
  app.post('/api/datasets/import', async (req, reply) => {
    if (denied(req, reply, 'import')) return;
    const body = BodySchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'body must be { groupId: string }' });
    try {
      const result = await importDataset(db, body.data.groupId, deps);
      logEvent(db, actorOf(req), { type: 'data.imported', summary: `Импорт набора ${result.groupId}: ${result.imported} из ${result.total}`, data: { groupId: result.groupId, imported: result.imported, failed: result.failed.length } });
      // Store the calls' recordings locally in the background: playback then survives expired links and host outages.
      if (audio) {
        const calls = db.select({ id: conversations.id, audioUrl: conversations.audioUrl }).from(conversations).all();
        void prefetchAudio(audio, calls, (m) => req.log.warn(m)).then((n) => n && req.log.info({ stored: n }, 'recordings stored'));
      }
      return result;
    } catch (e) {
      if (e instanceof ImportError) return reply.code(e.status).send({ error: e.message });
      req.log.error({ err: e instanceof Error ? e.message : 'unknown' }, 'import failed');
      return reply.code(500).send({ error: 'import failed' });
    }
  });
}
