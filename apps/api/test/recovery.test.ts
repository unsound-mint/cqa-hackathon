import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.js';
import { conversations, checklistVersions, evaluations, jobs } from '../src/db/schema.js';
import { JobRunner } from '../src/services/evaluation/jobs.js';
import type { LlmProvider, ProviderRequest } from '../src/services/evaluation/provider.js';

const log = { info() {}, error() {} };
const make = () => {
  const db = openDb(':memory:');
  db.insert(checklistVersions).values({ id: 'custom', version: 1, title: 'Custom', createdAt: 'now', criteria: [{ id: 'custom', title: 'Thanks', instructions: 'Did operator thank the client?', kind: 'boolean', allowedValues: [true, false], weight: 10, allowNA: false }] }).run();
  for (const id of ['a', 'b']) db.insert(conversations).values({ id, datasetGroupId: 'fictional', language: 'EN', channel: 'agent chat', audioUrl: null, importedAt: 'now', transcript: [{ index: 0, timestamp: '00:00', speaker: 'client', text: 'Help please.' }, { index: 1, timestamp: '00:01', speaker: 'operator', text: 'Thanks for contacting us.' }] }).run();
  return db;
};
const answer = { results: [{ criterionId: 'custom', value: true, isNA: false, explanation: 'Thanked client.', evidence: [{ messageIndex: 1, quote: 'Thanks' }] }] };
const provider = (respond: (req: ProviderRequest, n: number) => unknown): LlmProvider => {
  let n = 0; return { name: 'test', model: 'test', async complete(req) { return { output: respond(req, ++n), usage: { inputTokens: 10, outputTokens: 5 } }; } };
};
const input = { conversationIds: ['a', 'b'], checklistVersionId: 'custom' };

describe('durable evaluation recovery', () => {
  it('retries failed work only, retaining failed usage and successful results', async () => {
    const db = make(); const p = provider((req, n) => JSON.parse(req.user).conversation.transcript.length && n <= 2 ? {} : answer);
    const runner = new JobRunner(db, p, log, 1, { retryDelayMs: 0 });
    const job = runner.start(input); await runner.idle();
    expect(runner.getJob(job.id)).toMatchObject({ status: 'completed', succeeded: 2, failed: 0, completed: 2, total: 2 });
    const all = db.select().from(evaluations).all();
    expect(all.filter(e => e.conversationId === 'b')).toHaveLength(1);
    expect(all.filter(e => e.status === 'failed')).toHaveLength(1);
    expect(all.find(e => e.status === 'failed')?.provenance).toMatchObject({ usage: { inputTokens: 20, outputTokens: 10 } });
    expect(all.find(e => e.status === 'failed')?.diagnostics).toMatchObject({ calls: expect.arrayContaining([expect.objectContaining({ problems: expect.any(Array) })]) });
  });
  it('reports a partial batch after bounded exhaustion and permits failed-only retry', async () => {
    const db = make();
    const runner = new JobRunner(db, provider(() => ({})), log, 1, { retryDelayMs: 0 });
    // One success is already committed to this job, as after a restart.
    const seed = new JobRunner(db, provider(() => answer), log, 1, { retryDelayMs: 0 });
    const first = seed.start({ ...input, conversationIds: ['b'] }); await seed.idle();
    db.insert(jobs).values({ id: 'resume', checklistVersionId: 'custom', conversationIds: ['a','b'], evaluationIds: seed.getJob(first.id)!.evaluationIds, total: 2, completed: 1, status: 'running', createdAt: 'now', maxAttempts: 2 }).run();
    runner.resume(); runner.resume(); await runner.idle();
    expect(runner.getJob('resume')).toMatchObject({ status: 'partial', succeeded: 1, failed: 1, completed: 2 });
    expect(db.select().from(evaluations).all().filter(e => e.conversationId === 'b')).toHaveLength(1);
    const good = new JobRunner(db, provider(() => answer), log, 1, { retryDelayMs: 0 });
    const retry = good.start({ ...input, retryFailedOnly: true }); await good.idle();
    expect(good.getJob(retry.id)).toMatchObject({ total: 1, succeeded: 1, failed: 0 });
    expect(db.select().from(evaluations).all().filter(e => e.conversationId === 'b')).toHaveLength(1);
  });
  it('resumes an interrupted retry without resetting its budget or touching successful chats', async () => {
    const db = make();
    const first = new JobRunner(db, provider(() => ({})), log, 1, { maxAttempts: 1, retryDelayMs: 0 });
    const j = first.start({ ...input, conversationIds: ['a'] }); await first.idle();
    db.insert(jobs).values({ id: 'interrupted', checklistVersionId: 'custom', conversationIds: ['a'], evaluationIds: first.getJob(j.id)!.evaluationIds, total: 1, completed: 0, status: 'running', createdAt: 'now', maxAttempts: 2 }).run();
    const resumed = new JobRunner(db, provider(() => answer), log, 1, { retryDelayMs: 0 });
    resumed.resume(); resumed.resume(); await resumed.idle();
    expect(resumed.getJob('interrupted')).toMatchObject({ status: 'completed', succeeded: 1 });
    expect(db.select().from(evaluations).all()).toHaveLength(2);
  });
  it('counts interrupted in-flight work against the budget and waits when provider configuration is absent', async () => {
    const db = make();
    db.insert(evaluations).values({ id: 'inflight', conversationId: 'a', checklistVersionId: 'custom', status: 'running', originalResults: [], finalResults: [], originalTotal: null, finalTotal: null, seriousViolation: false, createdAt: '2020-01-01', diagnostics: { jobId: 'crashed', attempt: 1, calls: [] } }).run();
    db.insert(jobs).values({ id: 'crashed', checklistVersionId: 'custom', conversationIds: ['a'], evaluationIds: ['inflight'], total: 1, completed: 0, status: 'running', createdAt: 'now', maxAttempts: 2 }).run();
    const missing = new JobRunner(db, undefined, log, 1, { retryDelayMs: 0 });
    missing.resume(); await missing.idle();
    expect(missing.getJob('crashed')).toMatchObject({ status: 'pending', retrying: 1 });
    expect(db.select().from(evaluations).all()).toHaveLength(1);
    const resumed = new JobRunner(db, provider(() => ({})), log, 1, { retryDelayMs: 0 });
    resumed.resume(); await resumed.idle();
    expect(resumed.getJob('crashed')).toMatchObject({ status: 'failed', failed: 1 });
    expect(db.select().from(evaluations).all()).toHaveLength(2);
    resumed.resume(); await resumed.idle();
    expect(db.select().from(evaluations).all()).toHaveLength(2);
  });
  it('reattaches duplicate starts and does not launch the same active job twice', async () => {
    const db = make(); let release!: () => void; let n = 0;
    const p: LlmProvider = { name: 'test', model: 'test', async complete() { n++; await new Promise<void>(r => { release = r; }); return { output: answer }; } };
    const runner = new JobRunner(db, p, log, 1, { retryDelayMs: 0 });
    const j = runner.start({ ...input, conversationIds: ['a'] });
    expect(runner.start({ ...input, conversationIds: ['a'] }).id).toBe(j.id);
    runner.resume();
    expect(n).toBe(1);
    expect(() => runner.start(input)).toThrow(/already running/);
    release(); await runner.idle();
    expect(runner.getJob(j.id)).toMatchObject({ succeeded: 1, failed: 0 });
  });

});
