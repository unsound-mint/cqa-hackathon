import Fastify from 'fastify';
import { openDb, type Db } from './db/index.js';
import { checklistRoutes } from './routes/checklists.js';
import { conversationRoutes } from './routes/conversations.js';
import { datasetRoutes } from './routes/datasets.js';
import { seedOriginalChecklist } from './services/checklists.js';
import type { ImportDeps } from './services/import/importer.js';

export type AppOptions = { db?: Db; importDeps?: ImportDeps };

/** App factory (no listen) so tests can use `app.inject`. Defaults read the environment. */
export function buildApp(opts: AppOptions = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  const db = opts.db ?? openDb(process.env.DATABASE_PATH ?? '../../data/cqa.sqlite');
  const importDeps = opts.importDeps ?? { baseUrl: process.env.DATASET_IMPORT_URL };

  seedOriginalChecklist(db);

  app.get('/health', async () => ({ status: 'ok', service: 'cqa-api' }));
  conversationRoutes(app, db);
  checklistRoutes(app, db);
  datasetRoutes(app, db, importDeps);
  return app;
}
