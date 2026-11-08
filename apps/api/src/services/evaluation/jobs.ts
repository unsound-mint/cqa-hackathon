import { JobSchema, type Evaluation, type Job, type StartEvaluationInput } from '@cqa/contracts';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/index.js';
import { evaluations, jobs } from '../../db/schema.js';
import { getChecklist } from '../checklists.js';
import { getConversation } from '../conversations.js';
import { notifyCritical } from '../notifications.js';
import { insertEvaluation } from '../evaluations.js';
import type { DecisionFacts } from './semantic/index.js';
import { PROMPT_VERSION } from './prompts.js';
import { EvaluationFailure, evaluateConversation, planCriteria } from './evaluator.js';
import { evaluationCacheContext, makeReuseLookup } from './reuse.js';
import type { LlmProvider } from './provider.js';

export class JobError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 | 503) { super(message); }
}
type Log = { info: (o: object, m?: string) => void; error: (o: object, m?: string) => void };
type JobRow = typeof jobs.$inferSelect;
type EvalRow = typeof evaluations.$inferSelect;

/** A conversation is terminal only after success or exhaustion. Attempt history stays append-only. */
function outcomes(job: JobRow, recorded: EvalRow[]) {
  const byConversation = new Map<string, EvalRow[]>();
  // evaluationIds is the durable attempt order, independent of equal timestamps or random ids.
  const byId = new Map(recorded.map(e => [e.id, e]));
  for (const id of job.evaluationIds) {
    const e = byId.get(id);
    if (e) byConversation.set(e.conversationId, [...(byConversation.get(e.conversationId) ?? []), e]);
  }
  let succeeded = 0, failed = 0, retrying = 0;
  for (const list of byConversation.values()) {
    const e = list.at(-1)!;
    if (e.status === 'completed') succeeded++;
    else if (e.status === 'failed' && (list.length >= job.maxAttempts || (e.diagnostics as Evaluation['diagnostics'])?.retryable === false)) failed++;
    else retrying++;
  }
  return { byConversation, succeeded, failed, retrying };
}

export class JobRunner {
  private running = new Map<string, Promise<void>>();
  constructor(private readonly db: Db, private readonly provider: LlmProvider | undefined, private readonly log: Log, private readonly concurrency = 3, private readonly options: { maxAttempts?: number; retryDelayMs?: number } = {}) {}

  private recorded(job: JobRow) {
    return job.evaluationIds.length ? this.db.select().from(evaluations).where(inArray(evaluations.id, job.evaluationIds)).all() : [];
  }
  conversationIds(id: string): string[] | undefined { return this.db.select().from(jobs).where(eq(jobs.id, id)).get()?.conversationIds; }

  start(input: StartEvaluationInput): Job {
    const checklist = getChecklist(this.db, input.checklistVersionId);
    if (!checklist) throw new JobError('checklist version not found', 404);
    let ids = [...new Set(input.conversationIds)];
    if (ids.some(id => !getConversation(this.db, id))) throw new JobError('conversations not found', 404);
    if (input.retryFailedOnly) {
      ids = ids.filter(id => this.db.select().from(evaluations).where(eq(evaluations.conversationId, id)).all()
        .filter(e => e.checklistVersionId === checklist.id).sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).at(-1)?.status === 'failed');
      if (!ids.length) throw new JobError('no failed conversations on this checklist to retry', 409);
    }
    const force = !!(input.force || input.fresh || input.retryFailedOnly);
    // Avoid overlapping paid work; exact repeats reattach to the durable active job.
    for (const active of this.db.select().from(jobs).where(inArray(jobs.status, ['pending', 'running'])).all()) {
      if (active.checklistVersionId !== checklist.id || !active.conversationIds.some(id => ids.includes(id))) continue;
      if (active.force === force && active.conversationIds.length === ids.length && active.conversationIds.every(id => ids.includes(id))) return this.getJob(active.id)!;
      throw new JobError('evaluation already running for these conversations', 409);
    }
    if (!this.provider && ids.some(id => {
      const p = planCriteria(getConversation(this.db, id)!, checklist, force ? undefined : makeReuseLookup(this.db, id, this.provider));
      return p.undecided.length + p.assisted.length > 0;
    })) throw new JobError('no model provider configured (set ANTHROPIC_API_KEY)', 503);
    const row = { id: `job-${randomUUID()}`, checklistVersionId: checklist.id, conversationIds: ids, evaluationIds: [] as string[], force, maxAttempts: this.options.maxAttempts ?? 2, status: 'running', total: ids.length, completed: 0, createdAt: new Date().toISOString() };
    this.db.insert(jobs).values(row).run(); this.launch(row.id);
    return this.getJob(row.id)!;
  }

  getJob(id: string): Job | undefined {
    const row = this.db.select().from(jobs).where(eq(jobs.id, id)).get();
    if (!row) return;
    const { succeeded, failed, retrying } = outcomes(row, this.recorded(row));
    return JobSchema.parse({ ...row, succeeded, failed, retrying });
  }
  resume(): void { for (const j of this.db.select().from(jobs).where(inArray(jobs.status, ['pending', 'running'])).all()) this.launch(j.id); }
  async idle(): Promise<void> { while (this.running.size) await Promise.all([...this.running.values()]); }
  private launch(jobId: string) {
    if (this.running.has(jobId)) return;
    const p = this.run(jobId).catch((e: unknown) => {
      this.log.error({ jobId, err: e instanceof Error ? e.message : 'unknown' }, 'job crashed');
      this.db.update(jobs).set({ status: 'failed' }).where(eq(jobs.id, jobId)).run();
    }).finally(() => this.running.delete(jobId));
    this.running.set(jobId, p);
  }
  private async run(jobId: string): Promise<void> {
    const initial = this.db.select().from(jobs).where(eq(jobs.id, jobId)).get()!;
    const checklist = getChecklist(this.db, initial.checklistVersionId)!;
    // A reserved running attempt means the old process stopped before committing its outcome.
    // It consumes its durable budget; do not silently reset retries or turn unknown spend into zero.
    for (const e of this.recorded(initial)) if (e.status === 'running' || e.status === 'pending') {
      this.db.update(evaluations).set({ status: 'failed', error: 'Evaluation interrupted before its outcome was saved; usage unavailable', diagnostics: { ...(e.diagnostics as Evaluation['diagnostics']), calls: [], retryable: true } }).where(eq(evaluations.id, e.id)).run();
    }
    const state = outcomes(initial, this.recorded(initial));
    const queue = initial.conversationIds.filter(id => {
      const list = state.byConversation.get(id) ?? [], last = list.at(-1);
      return last?.status !== 'completed' && list.length < initial.maxAttempts && (last?.diagnostics as Evaluation['diagnostics'])?.retryable !== false;
    });
    if (!this.provider && queue.some(id => {
      const plan = planCriteria(getConversation(this.db, id)!, checklist, initial.force ? undefined : makeReuseLookup(this.db, id));
      return plan.undecided.length + plan.assisted.length > 0;
    })) {
      this.db.update(jobs).set({ status: 'pending' }).where(eq(jobs.id, jobId)).run();
      return; // Configuration can be restored before the next restart; do not spend attempts on a missing key.
    }
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const conversation = getConversation(this.db, id)!;
        const previous = state.byConversation.get(id) ?? [];
        for (let number = previous.length + 1; number <= initial.maxAttempts; number++) {
          const last = previous.at(-1);
          if (last?.status === 'failed') {
            const due = Date.parse(last.createdAt) + (this.options.retryDelayMs ?? 1000) * 2 ** (number - 2);
            await new Promise(r => setTimeout(r, Math.max(0, due - Date.now())));
          }
          const base = { id: `eval-${randomUUID()}`, conversationId: id, checklistVersionId: checklist.id };
          const reserved: Evaluation = { ...base, status: 'running', originalResults: [], finalResults: [], originalTotal: null, finalTotal: null, seriousViolation: false, provenance: { provider: this.provider?.name ?? 'none', model: this.provider?.model ?? 'none', promptVersion: PROMPT_VERSION }, diagnostics: { jobId, attempt: number, calls: [] } };
          this.db.transaction(tx => {
            insertEvaluation(tx as unknown as Db, reserved, evaluationCacheContext(conversation, this.provider));
            const cur = tx.select().from(jobs).where(eq(jobs.id, jobId)).get()!;
            tx.update(jobs).set({ evaluationIds: [...cur.evaluationIds, base.id] }).where(eq(jobs.id, jobId)).run();
          });
          let ev: Evaluation, decisionFacts: DecisionFacts | undefined;
          try {
            const r = await evaluateConversation(this.provider, conversation, checklist, initial.force ? undefined : makeReuseLookup(this.db, id, this.provider));
            decisionFacts = r.decisionFacts;
            ev = { ...base, status: 'completed', originalResults: r.results, originalTotal: r.total, finalResults: structuredClone(r.results), finalTotal: r.total, seriousViolation: r.seriousViolation, provenance: r.provenance, diagnostics: { ...r.diagnostics, jobId, attempt: number } };
          } catch (e) {
            const error = e instanceof Error ? e.message : 'evaluation failed';
            const failure = e instanceof EvaluationFailure ? e : undefined;
            decisionFacts = failure?.decisionFacts;
            ev = { ...base, status: 'failed', originalResults: [], originalTotal: null, finalResults: [], finalTotal: null, seriousViolation: false, error, provenance: failure?.provenance ?? { provider: this.provider?.name ?? 'none', model: this.provider?.model ?? 'none', promptVersion: 'n/a' }, diagnostics: { ...failure?.diagnostics, jobId, attempt: number, calls: failure?.diagnostics?.calls ?? [] } };
          }
          this.db.transaction(tx => {
            // A reserved row receives its AI result exactly once, at the terminal transition.
            tx.update(evaluations).set({ ...ev, decisionFacts: decisionFacts ?? null, provenance: ev.provenance ?? null, error: ev.error ?? null }).where(eq(evaluations.id, ev.id)).run();
            notifyCritical(tx as unknown as Db, ev);
            const cur = tx.select().from(jobs).where(eq(jobs.id, jobId)).get()!;
            const updated = cur;
            const rows = updated.evaluationIds.length ? tx.select().from(evaluations).where(inArray(evaluations.id, updated.evaluationIds)).all() : [];
            const { succeeded, failed } = outcomes(updated, rows);
            tx.update(jobs).set({ evaluationIds: updated.evaluationIds, completed: succeeded + failed }).where(eq(jobs.id, jobId)).run();
          });
          this.log.info({ jobId, conversationId: id, attempt: number, status: ev.status, ...ev.provenance?.usage }, 'evaluation attempt');
          if (ev.status === 'completed' || ev.diagnostics?.retryable === false) break;
          previous.push(this.db.select().from(evaluations).where(eq(evaluations.id, ev.id)).get()!);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, queue.length) }, worker));
    const job = this.getJob(jobId)!;
    this.db.update(jobs).set({ status: job.failed ? (job.succeeded ? 'partial' : 'failed') : 'completed', completed: (job.succeeded ?? 0) + (job.failed ?? 0) }).where(eq(jobs.id, jobId)).run();
  }
}
