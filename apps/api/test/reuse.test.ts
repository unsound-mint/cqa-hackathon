import { readFileSync } from 'node:fs';
import { DemoBundleSchema, type Conversation } from '@cqa/contracts';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db/index.js';
import { conversations } from '../src/db/schema.js';
import { ORIGINAL_CHECKLIST } from '../src/services/checklists.js';
import type { LlmProvider, ProviderRequest } from '../src/services/evaluation/provider.js';

const conv = DemoBundleSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/demo.json', import.meta.url), 'utf8'))).conversations[0]!;
const { id: _i, version: _v, createdAt: _c, ...strip } = ORIGINAL_CHECKLIST;

function modelFor(req: ProviderRequest) {
  const p = JSON.parse(req.user) as { checklist: { criteria: { id: string; kind: string; allowedValues: unknown[]; allowNA: boolean }[] }; conversation: { transcript: { text: string }[] } };
  return {
    results: p.checklist.criteria.map((c) => ({
      criterionId: c.id,
      value: c.kind === 'discrete-scale' ? [...(c.allowedValues as number[])].sort((a, b) => b - a)[1] : c.id === '08' ? false : true, // second-best tier, so totals are not 100
      isNA: false, explanation: 'ok', confidence: 'high',
      evidence: [{ messageIndex: 8, quote: p.conversation.transcript[8]!.text.slice(0, 8) }],
    })),
  };
}
function provider() {
  const calls: ProviderRequest[] = [];
  const p: LlmProvider & { calls: ProviderRequest[] } = { name: 'fake', model: 'fake-1', calls, async complete(req) { calls.push(req); return { output: modelFor(req) }; } };
  return p;
}
async function setup(p: LlmProvider | null, extra: Conversation[] = []) {
  const db = openDb(':memory:');
  for (const c of [conv, ...extra]) db.insert(conversations).values({ ...c, importedAt: 'now' }).run();
  const app = buildApp({ db, provider: p });
  return { app, db };
}
type App = Awaited<ReturnType<typeof setup>>['app'];
async function evaluate(app: App, checklistVersionId: string, ids = [conv.id]) {
  const res = await app.inject({ method: 'POST', url: '/api/evaluations', payload: { conversationIds: ids, checklistVersionId } });
  if (res.statusCode !== 202) return { res };
  await app.runner.idle();
  const job = (await app.inject({ url: `/api/jobs/${res.json().jobId}` })).json();
  const evs = await Promise.all(job.evaluationIds.map(async (id: string) => (await app.inject({ url: `/api/evaluations/${id}` })).json()));
  return { res, job, ev: evs[0] };
}
const save = async (app: App, criteria: object[]) => (await app.inject({ method: 'POST', url: '/api/checklists', payload: { ...strip, criteria } })).json();

describe('rules decide first, the model gets only the rest', () => {
  it('criteria 01 and 07 are decided by detectors and never sent to the model', async () => {
    const p = provider();
    const { app } = await setup(p);
    const { ev } = await evaluate(app, 'checklist-original-v1');
    const by = (id: string) => ev.originalResults.find((r: { criterionId: string }) => r.criterionId === id);
    expect(by('01')).toMatchObject({ source: 'rule', value: true });
    expect(by('07')).toMatchObject({ source: 'rule', value: true });
    expect(by('04')).toMatchObject({ source: 'model' });
    const sent = JSON.parse(p.calls[0]!.user);
    expect(sent.checklist.criteria.map((c: { id: string }) => c.id)).toEqual(['02', '03', '04', '05', '06', '08']);
    expect(sent.alreadyDecided.map((r: { criterionId: string }) => r.criterionId)).toEqual(['01', '07']);
  });

  it('the model cannot claim rule provenance or reuse', async () => {
    const p = provider();
    p.complete = async (req) => { const o = modelFor(req); o.results.forEach((r) => Object.assign(r, { source: 'rule', reusedFrom: 'eval-fake' })); return { output: o }; };
    const { app } = await setup(p);
    const { ev } = await evaluate(app, 'checklist-original-v1');
    const m = ev.originalResults.find((r: { criterionId: string }) => r.criterionId === '04');
    expect(m.source).toBe('model');
    expect(m.reusedFrom).toBeUndefined();
  });
});

describe('switching a criterion off needs no model call (live-demo path)', () => {
  it('weight 0 on criterion 01 rescoring works with NO provider and changes only the total', async () => {
    const p = provider();
    const { app } = await setup(p);
    const first = (await evaluate(app, 'checklist-original-v1')).ev;
    const calls = p.calls.length;

    const v2 = await save(app, ORIGINAL_CHECKLIST.criteria.map((c) => (c.id === '01' ? { ...c, weight: 0 } : c)));
    const second = (await evaluate(app, v2.id)).ev;
    expect(p.calls.length).toBe(calls); // not a single new model call
    expect(second.checklistVersionId).toBe(v2.id);
    expect(second.originalTotal).not.toBe(first.originalTotal);
    for (const r of second.originalResults) expect(r.reusedFrom ?? r.source).toBeTruthy();
    expect(second.originalResults.find((r: { criterionId: string }) => r.criterionId === '04').reusedFrom).toBe(first.id);
    expect(second.provenance).toMatchObject({ provider: 'local', model: 'rules+reuse' });
  });

  it('works end-to-end with the provider removed after the first evaluation', async () => {
    const db = openDb(':memory:');
    db.insert(conversations).values({ ...conv, importedAt: 'now' }).run();
    const p = provider();
    const withModel = buildApp({ db, provider: p });
    const first = (await evaluate(withModel, 'checklist-original-v1')).ev;
    const v2 = await save(withModel, ORIGINAL_CHECKLIST.criteria.map((c) => (c.id === '05' ? { ...c, weight: 0 } : c)));
    const offline = buildApp({ db, provider: null });
    const { ev, res } = await evaluate(offline, v2.id);
    expect(res.statusCode).toBe(202);
    expect(ev.status).toBe('completed');
    expect(ev.originalTotal).not.toBe(first.originalTotal);
  });

  it('changing a criterion\'s instructions invalidates reuse for that criterion only', async () => {
    const p = provider();
    const { app } = await setup(p);
    await evaluate(app, 'checklist-original-v1');
    const before = p.calls.length;
    const v2 = await save(app, ORIGINAL_CHECKLIST.criteria.map((c) => (c.id === '05' ? { ...c, instructions: 'Новая формулировка пятого критерия' } : c)));
    const { ev } = await evaluate(app, v2.id);
    expect(p.calls.length).toBe(before + 1);
    expect(JSON.parse(p.calls.at(-1)!.user).checklist.criteria.map((c: { id: string }) => c.id)).toEqual(['05']);
    expect(ev.originalResults.find((r: { criterionId: string }) => r.criterionId === '05').source).toBe('model');
    expect(ev.originalResults.find((r: { criterionId: string }) => r.criterionId === '04').reusedFrom).toBeTruthy();
  });

  it('without a provider, a needed model call is refused up front with 503', async () => {
    const { app } = await setup(null);
    const { res } = await evaluate(app, 'checklist-original-v1');
    expect(res.statusCode).toBe(503);
  });

  it('a user-added criterion is decided by the model; reviewer overrides are not carried over', async () => {
    const p = provider();
    const { app } = await setup(p);
    const first = (await evaluate(app, 'checklist-original-v1')).ev;
    const ap = (await app.inject({ method: 'POST', url: `/api/evaluations/${first.id}/appeals`, payload: { criterionId: '04', comment: 'c' } })).json();
    await app.inject({ method: 'POST', url: `/api/appeals/${ap.id}/decision`, payload: { action: 'override', reason: 'r', value: 10 } });
    const v2 = await save(app, [...ORIGINAL_CHECKLIST.criteria, { id: 'x1', title: 'Новый', instructions: 'любой текст', weight: 5, kind: 'boolean', allowedValues: [true, false], allowNA: false }]);
    const { ev } = await evaluate(app, v2.id);
    expect(ev.originalResults.find((r: { criterionId: string }) => r.criterionId === 'x1').source).toBe('model');
    expect(ev.originalResults.find((r: { criterionId: string }) => r.criterionId === '04').value).toBe(15); // the original decision, not the override (10)
  });
});

describe('detector names and agent-improvement report', () => {
  it('lists detectors and rejects unknown ones when saving a checklist', async () => {
    const { app } = await setup(provider());
    expect((await app.inject({ url: '/api/detectors' })).json().map((d: { name: string }) => d.name).sort()).toEqual(['closing', 'greeting-intro']);
    const bad = await app.inject({ method: 'POST', url: '/api/checklists', payload: { ...strip, criteria: strip.criteria.map((c) => (c.id === '02' ? { ...c, detector: 'nope' } : c)) } });
    expect(bad.statusCode).toBe(400);
    expect(JSON.stringify(bad.json())).toContain('unknown detector nope');
  });

  it('reports shortfalls on criteria that have an agent hint, from final results', async () => {
    const p = provider();
    p.complete = async (req) => { const o = modelFor(req); o.results.forEach((r) => { if (r.criterionId === '06') r.value = 4; }); return { output: o }; };
    const { app } = await setup(p);
    const { ev } = await evaluate(app, 'checklist-original-v1');
    const rep = (await app.inject({ url: '/api/insights/agent-improvements' })).json();
    expect(rep).toMatchObject({ checklistVersionId: 'checklist-original-v1', evaluations: 1 });
    const item = (id: string) => rep.items.find((i: { criterionId: string }) => i.criterionId === id);
    expect(item('06')).toMatchObject({ evaluated: 1, shortfalls: 1, conversationIds: [conv.id], ruleCheckable: false });
    expect(item('01')).toMatchObject({ evaluated: 1, shortfalls: 0, ruleCheckable: true });
    expect(item('04')).toBeUndefined(); // no deterministic fix, no hint
    // a reviewer fixing the result removes the shortfall
    const ap = (await app.inject({ method: 'POST', url: `/api/evaluations/${ev.id}/appeals`, payload: { criterionId: '06', comment: 'c' } })).json();
    await app.inject({ method: 'POST', url: `/api/appeals/${ap.id}/decision`, payload: { action: 'override', reason: 'r', value: 10 } });
    expect((await app.inject({ url: '/api/insights/agent-improvements' })).json().items.find((i: { criterionId: string }) => i.criterionId === '06').shortfalls).toBe(0);
    expect((await app.inject({ url: '/api/insights/agent-improvements?checklistVersionId=nope' })).statusCode).toBe(404);
  });

  it('refreshes an outdated, unused stored v1 from the canonical data, but never one that was used', async () => {
    const db = openDb(':memory:');
    buildApp({ db, provider: null });
    const stale = { ...ORIGINAL_CHECKLIST, criteria: ORIGINAL_CHECKLIST.criteria.map(({ detector: _d, ...c }) => c) };
    const { checklistVersions } = await import('../src/db/schema.js');
    db.update(checklistVersions).set({ criteria: stale.criteria }).run();
    const app = buildApp({ db, provider: null });
    expect((await app.inject({ url: '/api/checklists' })).json()[0].criteria[0].detector).toBe('greeting-intro');
  });
});
