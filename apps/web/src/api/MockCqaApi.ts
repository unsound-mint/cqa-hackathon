import {
  DemoBundleSchema,
  SaveChecklistInputSchema,
  CreateAppealInputSchema,
  DecideAppealInputSchema,
  StartEvaluationInputSchema,
  scoreEvaluation,
  type Appeal,
  type ChecklistVersion,
  type Conversation,
  type Criterion,
  type CriterionResult,
  type Evaluation,
  type Job,
} from '@cqa/contracts';
import demoJson from '../../../../fixtures/demo.json';
import { CqaApiError, type CqaApi } from './CqaApi';

/**
 * In-memory CqaApi over the fictional fixtures/demo.json. Everything it returns is MOCK output
 * (provenance.provider === 'mock'); it never calls a model or the network. Returns deep copies so UI
 * code cannot mutate its state.
 */
const clone = <T>(v: T): T => structuredClone(v);
const DELAY_MS = 0;
const later = async <T>(v: T): Promise<T> => {
  if (DELAY_MS) await new Promise((r) => setTimeout(r, DELAY_MS));
  return clone(v);
};

/** Placeholder result built from criterion config only (no id switch): first non-N/A allowed value. */
function placeholderResult(c: Criterion, lastIndex: number): CriterionResult {
  const best = c.kind === 'discrete-scale' ? Math.max(...(c.allowedValues as number[])) : c.criticalFlag ? false : c.allowedValues[0]!;
  return {
    criterionId: c.id,
    value: best,
    isNA: false,
    explanation: 'MOCK placeholder: generated from the criterion configuration, not from the transcript.',
    evidence: [],
    checkedRange: { from: 0, to: lastIndex },
  };
}

export class MockCqaApi implements CqaApi {
  private conversations: Conversation[];
  private checklists: ChecklistVersion[];
  private evaluations: Evaluation[];
  private jobs = new Map<string, Job>();
  private appeals: Appeal[] = [];
  private seq = 0;

  constructor(bundle: unknown = demoJson) {
    const b = DemoBundleSchema.parse(bundle);
    this.conversations = clone(b.conversations);
    this.checklists = clone(b.checklists);
    this.evaluations = clone(b.evaluations);
  }

  private nextId(prefix: string) {
    return `${prefix}-${++this.seq}`;
  }

  async listConversations(query: { language?: Conversation['language']; channel?: Conversation['channel'] } = {}) {
    return later(
      this.conversations.filter((c) => (!query.language || c.language === query.language) && (!query.channel || c.channel === query.channel)),
    );
  }

  async getConversation(id: string) {
    const c = this.conversations.find((x) => x.id === id);
    if (!c) throw new CqaApiError('not_found', `conversation ${id} not found`);
    return later(c);
  }

  async listEvaluations(query: { conversationId?: string } = {}) {
    return later(this.evaluations.filter((e) => !query.conversationId || e.conversationId === query.conversationId));
  }

  async getEvaluation(id: string) {
    const e = this.evaluations.find((x) => x.id === id);
    if (!e) throw new CqaApiError('not_found', `evaluation ${id} not found`);
    return later(e);
  }

  async listChecklists() {
    return later(this.checklists);
  }

  /** Each save is a NEW immutable version (version = previous max + 1); old versions are untouched. */
  async saveChecklistVersion(input: unknown) {
    const parsed = SaveChecklistInputSchema.safeParse(input);
    if (!parsed.success) throw new CqaApiError('invalid', parsed.error.message);
    const version = Math.max(0, ...this.checklists.map((c) => c.version)) + 1;
    const saved: ChecklistVersion = { ...clone(parsed.data), id: `checklist-v${version}`, version, createdAt: new Date().toISOString() };
    this.checklists.push(saved);
    return later(saved);
  }

  /** Completes immediately. Evaluates against the requested checklist's own criteria with placeholder results. */
  async startEvaluation(input: unknown) {
    const parsed = StartEvaluationInputSchema.safeParse(input);
    if (!parsed.success) throw new CqaApiError('invalid', parsed.error.message);
    const checklist = this.checklists.find((c) => c.id === parsed.data.checklistVersionId);
    if (!checklist) throw new CqaApiError('not_found', `checklist ${parsed.data.checklistVersionId} not found`);
    const created: Evaluation[] = [];
    for (const conversationId of parsed.data.conversationIds) {
      const conv = this.conversations.find((c) => c.id === conversationId);
      if (!conv) throw new CqaApiError('not_found', `conversation ${conversationId} not found`);
      const results = checklist.criteria.map((c) => placeholderResult(c, conv.transcript.length - 1));
      const { total, seriousViolation } = scoreEvaluation(checklist, results);
      created.push({
        id: this.nextId('eval-mock'),
        conversationId,
        checklistVersionId: checklist.id,
        status: 'completed',
        originalResults: results,
        originalTotal: total,
        finalResults: clone(results),
        finalTotal: total,
        seriousViolation,
        provenance: { provider: 'mock', model: 'placeholder', promptVersion: 'n/a' },
      });
    }
    this.evaluations.push(...created);
    const jobId = this.nextId('job-mock');
    this.jobs.set(jobId, { id: jobId, status: 'completed', completed: created.length, total: created.length, evaluationIds: created.map((e) => e.id) });
    return later({ jobId });
  }

  async getJob(id: string) {
    const j = this.jobs.get(id);
    if (!j) throw new CqaApiError('not_found', `job ${id} not found`);
    return later(j);
  }

  async listAppeals(query: { evaluationId: string }) {
    return later(this.appeals.filter((a) => a.evaluationId === query.evaluationId));
  }

  async createAppeal(input: unknown) {
    const parsed = CreateAppealInputSchema.safeParse(input);
    if (!parsed.success) throw new CqaApiError('invalid', parsed.error.message);
    const ev = this.evaluations.find((e) => e.id === parsed.data.evaluationId);
    if (!ev) throw new CqaApiError('not_found', `evaluation ${parsed.data.evaluationId} not found`);
    if (!ev.originalResults.some((r) => r.criterionId === parsed.data.criterionId)) {
      throw new CqaApiError('invalid', `criterion ${parsed.data.criterionId} is not part of this evaluation`);
    }
    const appeal: Appeal = { id: this.nextId('appeal-mock'), ...parsed.data, status: 'pending', createdAt: new Date().toISOString() };
    this.appeals.push(appeal);
    return later(appeal);
  }

  /** Override rewrites finalResults + finalTotal only; originalResults/originalTotal are never touched. */
  async decideAppeal(input: unknown) {
    const parsed = DecideAppealInputSchema.safeParse(input);
    if (!parsed.success) throw new CqaApiError('invalid', parsed.error.message);
    const d = parsed.data;
    const appeal = this.appeals.find((a) => a.id === d.appealId);
    if (!appeal) throw new CqaApiError('not_found', `appeal ${d.appealId} not found`);
    if (appeal.status !== 'pending') throw new CqaApiError('conflict', `appeal ${appeal.id} is already ${appeal.status}`);
    const ev = this.evaluations.find((e) => e.id === appeal.evaluationId)!;
    const checklist = this.checklists.find((c) => c.id === ev.checklistVersionId)!;

    if (d.action === 'override') {
      const next = clone(ev.finalResults);
      const idx = next.findIndex((r) => r.criterionId === appeal.criterionId);
      const isNA = d.isNA === true;
      next[idx] = { ...next[idx]!, value: isNA ? null : (d.value ?? null), isNA, explanation: `Reviewer override: ${d.reason}` };
      let scored;
      try {
        scored = scoreEvaluation(checklist, next); // rejects disallowed values / N/A before anything is mutated
      } catch (e) {
        throw new CqaApiError('invalid', e instanceof Error ? e.message : 'invalid override');
      }
      ev.finalResults = next;
      ev.finalTotal = scored.total;
      ev.seriousViolation = scored.seriousViolation;
      appeal.status = 'overridden';
      appeal.reviewerValue = isNA ? null : (d.value ?? null);
      appeal.reviewerIsNA = isNA;
    } else {
      appeal.status = 'upheld';
    }
    appeal.decidedAt = new Date().toISOString();
    appeal.reviewerReason = d.reason;
    return later(appeal);
  }
}
