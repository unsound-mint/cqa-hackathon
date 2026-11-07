import Fastify from 'fastify';

/** App factory (no listen) so tests can use `app.inject`. */
export function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  app.get('/health', async () => ({ status: 'ok', service: 'cqa-api' }));
  return app;
}
