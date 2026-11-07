import Fastify from 'fastify';
import { openDb, type Db } from './db/index.js';
import { checklistRoutes } from './routes/checklists.js';
import { evaluationRoutes } from './routes/evaluations.js';
import { conversationRoutes } from './routes/conversations.js';
import { datasetRoutes } from './routes/datasets.js';
import { AnthropicProvider } from './services/evaluation/anthropic.js';
import { JobRunner } from './services/evaluation/jobs.js';
import type { LlmProvider } from './services/evaluation/provider.js';
import { seedOriginalChecklist } from './services/checklists.js';
import type { ImportDeps } from './services/import/importer.js';

export type AppOptions = { db?: Db; importDeps?: ImportDeps; provider?: LlmProvider | null };

/** Provider from the environment; null when no key is configured (evaluation endpoints answer 503). */
function providerFromEnv(): LlmProvider | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? new AnthropicProvider({ apiKey, model: process.env.CQA_MODEL || 'claude-haiku-5-5' }) : null;
}

/** App factory (no listen) so tests can use `app.inject`. Defaults read the environment. */
export function buildApp(opts: AppOptions = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  const db = opts.db ?? openDb(process.env.DATABASE_PATH ?? '../../data/cqa.sqlite');
  const importDeps = opts.importDeps ?? { baseUrl: process.env.DATASET_IMPORT_URL };

  seedOriginalChecklist(db);
  const provider = opts.provider === undefined ? providerFromEnv() : opts.provider;
  const runner = new JobRunner(db, provider ?? undefined, app.log);
  app.addHook('onClose', async () => runner.idle());

  app.get('/health', async () => ({ status: 'ok', service: 'cqa-api' }));
  conversationRoutes(app, db);
  checklistRoutes(app, db);
  evaluationRoutes(app, db, runner);
  runner.resume();
  datasetRoutes(app, db, importDeps);
  return Object.assign(app, { runner });
}
