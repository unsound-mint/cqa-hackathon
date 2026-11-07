import { expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

it('GET /health returns ok without any env or dataset', async () => {
  const app = buildApp();
  const res = await app.inject({ url: '/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: 'ok', service: 'cqa-api' });
  await app.close();
});
