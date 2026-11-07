import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db/index.js';

it('GET /health returns ok without any env or dataset', async () => {
  const app = buildApp({ db: openDb(':memory:') });
  const res = await app.inject({ url: '/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: 'ok', service: 'cqa-api' });
  await app.close();
});

it('serves the built web app with SPA fallback, without shadowing the API', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cqa-web-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>CQA</title>');
  const app = buildApp({ db: openDb(':memory:'), webDist: dir });
  expect((await app.inject({ url: '/' })).body).toContain('<title>CQA</title>');
  expect((await app.inject({ url: '/conversations/abc' })).body).toContain('<title>CQA</title>');
  expect((await app.inject({ url: '/api/nope' })).statusCode).toBe(404);
  expect((await app.inject({ url: '/health' })).json().status).toBe('ok');
  await app.close();
});
