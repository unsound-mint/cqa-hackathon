import { JobSchema, type Evaluation, type Job, type StartEvaluationInput } from '@cqa/contracts';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/index.js';
import { evaluations, jobs } from '../../db/schema.js';
import { getChecklist } from '../checklists.js';
import { getConversation } from '../conversations.js';
import { insertEvaluation } from '../evaluations.js';
import { evaluateConversation, planCriteria } from './evaluator.js';
import { makeReuseLookup } from './reuse.js';
import type { LlmProvider } from './provider.js';

export class JobError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 503,
  ) {
    super(message);
  }
}

type Log = { info: (o: object, m?: string) => void; error: (o: object, m?: string) => void };

function toJob(row: typeof jobs.$inferSelect): Job {
  return JobSchema.parse({ id: row.id, status: row.status, completed: row.completed, total: row.total, evaluationIds: row.evaluationIds });
}

/**
 * In-process batch runner. State lives in SQLite, so after a restart `resume()` continues only the
 * conversations that have no recorded evaluation yet; completed work is never recomputed.
 */
export class JobRunner {
  private running = new Set<Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly provider: LlmProvider | undefined,
    private readonly log: Log,
    private readonly concurrency = 3,
  ) {}

  start(input: StartEvaluationInput): Job {
    const checklist = getChecklist(this.db, input.checklistVersionId);
    if (!checklist) throw new JobError('checklist version not found', 404);
    const ids = [...new Set(input.conversationIds)];
    const missing = ids.filter((id) => !getConversation(this.db, id));
    if (missing.length) throw new JobError(`conversations not found: ${missing.slice(0, 5).join(', ')}`, 404);
    // A model is needed only if rules + reuse cannot settle every criterion (e.g. switching a criterion off needs none).
    if (!this.provider) {
      const needing = ids.filter((id) => ((pl) => pl.undecided.length + pl.assisted.length > 0)(planCriteria(getConversation(this.db, id)!, checklist, input.fresh ? undefined : makeReuseLookup(this.db, id))));
      if (needing.length) throw new JobError(`no model provider configured (set ANTHROPIC_API_KEY); ${needing.length} conversation(s) have criteria that need a model`, 503);
    }

    const row = { id: `job-${randomUUID()}`, checklistVersionId: input.checklistVersionId, conversationIds: ids, evaluationIds: [] as string[], status: 'running', total: ids.length, completed: 0, createdAt: new Date().toISOString(), fresh: input.fresh === true };
    this.db.insert(jobs).values(row).run();
    this.launch(row.id);
    return toJob(row);
  }

  getJob(id: string): Job | undefined {
    const row = this.db.select().from(jobs).where(eq(jobs.id, id)).get();
    return row ? toJob(row) : undefined;
  }

  /** Call once on boot. */
  resume(): void {
    for (const j of this.db.select().from(jobs).where(inArray(jobs.status, ['pending', 'running'])).all()) this.launch(j.id);
  }

  async idle(): Promise<void> {
    while (this.running.size) await Promise.all([...this.running]);
  }

  private launch(jobId: string) {
    const p = this.run(jobId)
      .catch((e: unknown) => {
        this.log.error({ jobId, err: e instanceof Error ? e.message : 'unknown' }, 'job crashed');
        this.db.update(jobs).set({ status: 'failed' }).where(eq(jobs.id, jobId)).run();
      })
      .finally(() => this.running.delete(p));
    this.running.add(p);
  }

  private async run(jobId: string): Promise<void> {
    const job = this.db.select().from(jobs).where(eq(jobs.id, jobId)).get()!;
    const checklist = getChecklist(this.db, job.checklistVersionId)!;
    const provider = this.provider;
    const recorded = job.evaluationIds.length ? this.db.select().from(evaluations).where(inArray(evaluations.id, job.evaluationIds)).all() : [];
    const done = new Set(recorded.map((e) => e.conversationId));
    const queue = job.conversationIds.filter((id) => !done.has(id));

    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const conversation = getConversation(this.db, id)!;
        const base = { id: `eval-${randomUUID()}`, conversationId: id, checklistVersionId: checklist.id };
        let ev: Evaluation;
        try {
          const r = await evaluateConversation(provider, conversation, checklist, job.fresh ? undefined : makeReuseLookup(this.db, id));
          this.log.info({ conversationId: id, provider: r.provenance.provider, model: r.provenance.model, modelCriteria: r.modelCriteria.length, latencyMs: r.latencyMs, ...r.usage }, 'evaluation cost');
          ev = { ...base, status: 'completed', originalResults: r.results, originalTotal: r.total, finalResults: structuredClone(r.results), finalTotal: r.total, seriousViolation: r.seriousViolation, provenance: r.provenance };
        } catch (e) {
          const message = e instanceof Error ? e.message : 'evaluation failed';
          this.log.error({ conversationId: id, err: message }, 'evaluation failed');
          ev = { ...base, status: 'failed', originalResults: [], originalTotal: null, finalResults: [], finalTotal: null, seriousViolation: false, provenance: { provider: provider?.name ?? 'none', model: provider?.model ?? 'none', promptVersion: 'n/a' }, error: message };
        }
        // Evaluation row and job progress commit together, so a crash never loses or duplicates one.
        this.db.transaction((tx) => {
          insertEvaluation(tx as unknown as Db, ev);
          const cur = tx.select().from(jobs).where(eq(jobs.id, jobId)).get()!;
          tx.update(jobs).set({ evaluationIds: [...cur.evaluationIds, ev.id], completed: cur.completed + 1 }).where(eq(jobs.id, jobId)).run();
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, queue.length) }, worker));

    const finalEvals = this.db.select().from(evaluations).where(inArray(evaluations.id, this.db.select().from(jobs).where(eq(jobs.id, jobId)).get()!.evaluationIds)).all();
    const allFailed = finalEvals.length > 0 && finalEvals.every((e) => e.status === 'failed');
    this.db.update(jobs).set({ status: allFailed ? 'failed' : 'completed' }).where(eq(jobs.id, jobId)).run();
  }
}
