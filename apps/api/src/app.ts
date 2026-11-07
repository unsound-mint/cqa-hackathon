import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { openDb, type Db } from './db/index.js';
import { checklistRoutes } from './routes/checklists.js';
import { evaluationRoutes } from './routes/evaluations.js';
import { conversationRoutes } from './routes/conversations.js';
import { prefetchAudio, type AudioStore, type FetchLike } from './services/audio.js';
import { conversations } from './db/schema.js';
import { dirname, join } from 'node:path';
import { datasetRoutes } from './routes/datasets.js';
import { AnthropicProvider, EFFORTS, type Effort } from './services/evaluation/anthropic.js';
import { JobRunner } from './services/evaluation/jobs.js';
import type { LlmProvider } from './services/evaluation/provider.js';
import { seedOriginalChecklist } from './services/checklists.js';
import type { ImportDeps } from './services/import/importer.js';

export type AppOptions = { db?: Db; importDeps?: ImportDeps; provider?: LlmProvider | null; /** Built web app to serve at `/`. Defaults to apps/web/dist when it exists. */ webDist?: string | null; /** Fetch used to resolve call recordings (tests). */ audioFetch?: FetchLike; /** Where stored recordings go; default data/private/audio next to the database (AUDIO_DIR overrides). */ audioDir?: string; /** Copy missing recordings when the server is ready; default on outside tests. */ prefetchOnStart?: boolean };

// Resolves to apps/web/dist from both src/ (dev) and dist/ (built): each is two levels below apps/web's sibling.
const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

/** Provider from the environment; null when no key is configured (evaluation endpoints answer 503). */
function providerFromEnv(): LlmProvider | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const effort = process.env.CQA_EFFORT || 'medium';
  if (!EFFORTS.includes(effort as Effort)) throw new Error(`CQA_EFFORT must be one of ${EFFORTS.join(', ')}`);
  return new AnthropicProvider({ apiKey, model: process.env.CQA_MODEL || 'claude-haiku-5-5', effort: effort as Effort });
}

/** App factory (no listen) so tests can use `app.inject`. Defaults read the environment. */
export function buildApp(opts: AppOptions = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  const dbPath = process.env.DATABASE_PATH ?? '../../data/cqa.sqlite';
  const db = opts.db ?? openDb(dbPath);
  const audio: AudioStore = { dir: opts.audioDir ?? process.env.AUDIO_DIR ?? join(dirname(dbPath), 'private', 'audio'), fetchFn: opts.audioFetch };
  const importDeps = opts.importDeps ?? { baseUrl: process.env.DATASET_IMPORT_URL };

  seedOriginalChecklist(db);
  const provider = opts.provider === undefined ? providerFromEnv() : opts.provider;
  const runner = new JobRunner(db, provider ?? undefined, app.log);
  app.addHook('onClose', async () => runner.idle());

  // Opt-in cross-origin access for the UI embedded elsewhere (Dynamics 365 web resource). CORS_ORIGIN: comma-separated origins.
  const corsOrigins = (process.env.CORS_ORIGIN ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  if (corsOrigins.length) {
    app.addHook('onRequest', async (req, reply) => {
      const origin = req.headers.origin;
      if (!origin || !corsOrigins.includes(origin)) return;
      reply.header('access-control-allow-origin', origin).header('vary', 'Origin');
      if (req.method === 'OPTIONS') return reply.header('access-control-allow-methods', 'GET,POST,OPTIONS').header('access-control-allow-headers', 'content-type').code(204).send();
    });
  }

  app.get('/health', async () => ({ status: 'ok', service: 'cqa-api' }));
  conversationRoutes(app, db, audio);
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
  // Tests never reach the network or write recordings unless they pass their own audioDir.
  const store = opts.audioDir !== undefined || process.env.NODE_ENV !== 'test' ? audio : undefined;
  datasetRoutes(app, db, importDeps, store);
  // Copies any recording missing from disk once the server is up: a database imported before recordings were stored,
  // a copy that failed (expired link, host down) or a fresh machine heals on the next start instead of on a failed play.
  if (store && (opts.prefetchOnStart ?? process.env.NODE_ENV !== 'test')) {
    app.addHook('onReady', async () => {
      const calls = db.select({ id: conversations.id, audioUrl: conversations.audioUrl }).from(conversations).all();
      void prefetchAudio(store, calls, (m) => app.log.warn(m)).then((n) => n && app.log.info({ stored: n }, 'recordings stored'));
    });
  }
  return Object.assign(app, { runner });
}
