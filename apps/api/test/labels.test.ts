import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DemoBundleSchema } from '@cqa/contracts';
import { parseLabels } from '@cqa/evaluation';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db/index.js';
import { conversations, humanLabelHistory } from '../src/db/schema.js';
import { ORIGINAL_CHECKLIST } from '../src/services/checklists.js';

const bundle = DemoBundleSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/demo.json', import.meta.url), 'utf8')));
const conv = bundle.conversations[0]!;

function setup(opts: { accessToken?: string } = {}) {
  const db = openDb(':memory:');
  db.insert(conversations).values({ ...conv, importedAt: 'now' }).run();
  return { db, app: buildApp({ db, provider: null, webDist: null, ...opts }) };
}
type App = ReturnType<typeof setup>['app'];
const put = (app: App, cid: string, body: object) => app.inject({ method: 'PUT', url: `/api/labels/${conv.id}/${cid}`, payload: body });
const ans = (value: unknown, extra: object = {}) => ({ value, isNA: false, evidence: [], ...extra });

describe('labeling API', () => {
  it('serves the labeling page', async () => {
    const { app } = setup();
    const res = await app.inject({ url: '/label' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Разметка диалогов');
  });

  it('saves, validates and reads back a label', async () => {
    const { app } = setup();
    const ok = await put(app, '04', ans(15, { evidence: [9, 8, 8], inspectedRange: { from: 4, to: 11 }, rationale: 'пропущена деталь', uncertainty: 'сомневаюсь', reviewer: 'Э' }));
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ criterionId: '04', value: 15, isNA: false, evidence: [8, 9], inspectedRange: { from: 4, to: 11 }, reviewer: 'Э' });
    expect((await app.inject({ url: `/api/labels?conversationId=${conv.id}` })).json()).toHaveLength(1);
  });

  it.each([
    ['a value that is not a tier', '04', ans(12)],
    ['N/A where the rubric forbids it', '01', { value: null, isNA: true }],
    ['N/A together with a value', '02', { value: true, isNA: true }],
    ['no answer at all', '05', ans(null)],
    ['evidence outside the transcript', '05', ans(true, { evidence: [99] })],
    ['an inspected range outside the transcript', '05', ans(true, { inspectedRange: { from: 0, to: 99 } })],
    ['a reversed range', '05', ans(true, { inspectedRange: { from: 5, to: 2 } })],
  ])('rejects %s', async (_n, cid, body) => {
    const { app } = setup();
    expect((await put(app, cid, body)).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/labels' })).json()).toEqual([]);
  });

  it('404s for unknown conversation or criterion', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'PUT', url: '/api/labels/ghost/01', payload: ans(true) })).statusCode).toBe(404);
    expect((await put(app, 'zz', ans(true))).statusCode).toBe(404);
  });

  it('keeps every earlier answer in an append-only history, including clears', async () => {
    const { app, db } = setup();
    await put(app, '04', ans(10));
    await put(app, '04', ans(20, { rationale: 'передумала' }));
    await app.inject({ method: 'DELETE', url: `/api/labels/${conv.id}/04` });
    expect((await app.inject({ url: '/api/labels' })).json()).toEqual([]);
    const history = db.select().from(humanLabelHistory).all();
    expect(history.map((h) => h.action)).toEqual(['save', 'save', 'clear']);
    expect((history[0]!.snapshot as { value: number }).value).toBe(10);
    expect((history[2]!.snapshot as { value: number }).value).toBe(20);
  });

  it('progress counts answered criteria and gives the human total only when complete (single scorer)', async () => {
    const { app } = setup();
    await put(app, '01', ans(true));
    expect((await app.inject({ url: '/api/labels/progress' })).json()).toEqual([{ conversationId: conv.id, labeled: 1, total: 8, humanTotal: null }]);
    const full: [string, unknown][] = [['02', true], ['03', true], ['04', 20], ['05', true], ['06', 10], ['07', true], ['08', false]];
    for (const [cid, v] of full) await put(app, cid, ans(v));
    expect((await app.inject({ url: '/api/labels/progress' })).json()[0]).toMatchObject({ labeled: 8, humanTotal: 100 });
    await put(app, '07', { value: null, isNA: true });
    await put(app, '04', ans(10));
    expect((await app.inject({ url: '/api/labels/progress' })).json()[0].humanTotal).toBe(89.47); // 85 of 95 applicable points
  });

  it('exports a CSV that the comparison tool reads back unchanged', async () => {
    const { app } = setup();
    await put(app, '04', ans(15, { evidence: [8, 9], inspectedRange: { from: 4, to: 11 }, rationale: 'a, "b"\nc' }));
    await put(app, '02', { value: null, isNA: true, evidence: [1] });
    await put(app, '08', ans(false));
    const csv = (await app.inject({ url: '/api/labels.csv' })).body;
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM so Excel reads Cyrillic
    const parsed = parseLabels(csv, ORIGINAL_CHECKLIST);
    expect(parsed.problems).toEqual([]);
    expect(parsed.labels.map((l) => [l.criterionId, l.value, l.isNA])).toEqual([['02', null, true], ['04', 15, false], ['08', false, false]]);
    expect(parsed.labels.find((l) => l.criterionId === '04')).toMatchObject({ evidence: [8, 9], inspectedRange: { from: 4, to: 11 }, rationale: 'a, "b"\nc' });
  });

  it('builds the comparison report from stored labels and stored evaluations', async () => {
    const { app, db } = setup();
    const { insertEvaluation } = await import('../src/services/evaluations.js');
    insertEvaluation(db, bundle.evaluations[0]!);
    for (const r of bundle.evaluations[0]!.originalResults) await put(app, r.criterionId, r.isNA ? { value: null, isNA: true } : ans(r.criterionId === '04' ? 20 : r.value));
    const res = (await app.inject({ url: '/api/validation/report' })).json();
    expect(res.report.coverage.fullyLabeled).toBe(1);
    expect(res.report.totals).toMatchObject({ n: 1, mae: 5.88 });
    expect(res.markdown).toContain('Where the score is lost');
    expect((await app.inject({ url: '/api/validation/report?checklistVersionId=nope' })).statusCode).toBe(404);
  });
});

describe('human labels stay out of the evaluator', () => {
  it('nothing under services/evaluation reads the label tables or services', () => {
    const dir = new URL('../src/services/evaluation/', import.meta.url);
    const files = (d: URL): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(new URL(`${e.name}/`, d)) : [join(d.pathname, e.name)]));
    for (const f of files(dir)) expect(readFileSync(f, 'utf8'), f).not.toMatch(/humanLabel|human_label|services\/labels|@cqa\/evaluation/);
  });
});

describe('access token', () => {
  it('blocks everything but /health until the key is given once, then uses a cookie', async () => {
    const { app } = setup({ accessToken: 'secret-key' });
    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/conversations' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/label?token=wrong' })).statusCode).toBe(401);
    const first = await app.inject({ url: '/label?token=secret-key' });
    expect(first.statusCode).toBe(302);
    expect(first.headers.location).toBe('/label');
    const cookie = String(first.headers['set-cookie']).split(';')[0]!;
    expect((await app.inject({ url: '/api/conversations', headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/conversations', headers: { cookie: 'cqa_token=nope' } })).statusCode).toBe(401);
  });

  it('is off when no token is configured', async () => {
    const { app } = setup();
    expect((await app.inject({ url: '/api/conversations' })).statusCode).toBe(200);
  });
});
