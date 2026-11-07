import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { openDb, type Db } from './db/index.js';
import { checklistRoutes } from './routes/checklists.js';
import { evaluationRoutes } from './routes/evaluations.js';
import { conversationRoutes } from './routes/conversations.js';
import type { FetchLike } from './services/audio.js';
import { datasetRoutes } from './routes/datasets.js';
import { AnthropicProvider } from './services/evaluation/anthropic.js';
import { JobRunner } from './services/evaluation/jobs.js';
import type { LlmProvider } from './services/evaluation/provider.js';
import { seedOriginalChecklist } from './services/checklists.js';
import type { ImportDeps } from './services/import/importer.js';

export type AppOptions = { db?: Db; importDeps?: ImportDeps; provider?: LlmProvider | null; /** Built web app to serve at `/`. Defaults to apps/web/dist when it exists. */ webDist?: string | null; /** Fetch used to resolve call recordings (tests). */ audioFetch?: FetchLike };

// Resolves to apps/web/dist from both src/ (dev) and dist/ (built): each is two levels below apps/web's sibling.
const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

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
  conversationRoutes(app, db, opts.audioFetch);
  checklistRoutes(app, db);
  evaluationRoutes(app, db, runner);
  runner.resume();

  // One process, one URL for the demo: serve the built web app, with SPA fallback for non-API paths.
  const webDist = opts.webDist === undefined ? (process.env.WEB_DIST ?? DEFAULT_WEB_DIST) : opts.webDist;
  if (webDist && existsSync(webDist)) {
    void app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && req.url !== '/health') return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not found' });
    });
  }
  datasetRoutes(app, db, importDeps);
  return Object.assign(app, { runner });
}
