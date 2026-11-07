import {
  DemoBundleSchema,
  SaveChecklistInputSchema,
  CreateAppealInputSchema,
  DecideAppealInputSchema,
  OverrideCriterionInputSchema,
  StartEvaluationInputSchema,
  AssignOperatorInputSchema,
  ROLE_LABELS,
  SetReviewInputSchema,
  can,
  canSee,
  scoreEvaluation,
  type Actor,
  type Appeal,
  type AssignOperatorInput,
  type Permission,
  type SetReviewInput,
  type ChecklistVersion,
  type Conversation,
  type Criterion,
  type CriterionResult,
  type CriterionValue,
  type Evaluation,
  type Job,
} from '@cqa/contracts';
import demoJson from '../../../../fixtures/demo.json';
import { getIdentity } from '@/lib/identity';
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
  private appeals: Appeal[];
  private seq = 0;

  constructor(bundle: unknown = demoJson, seedAppeals: Appeal[] = []) {
    const b = DemoBundleSchema.parse(bundle);
    this.conversations = clone(b.conversations);
    this.checklists = clone(b.checklists);
    this.evaluations = clone(b.evaluations);
    this.appeals = clone(seedAppeals);
  }

  private nextId(prefix: string) {
    return `${prefix}-${++this.seq}`;
  }

  /** The same rules as the API (apps/api/src/routes/actor.ts): what the picked role may do and see. */
  private actor(): Actor {
    return getIdentity();
  }
  private require(permission: Permission) {
    const a = this.actor();
    if (!can(a, permission)) throw new CqaApiError('forbidden', `Роль «${ROLE_LABELS[a.role]}» не может выполнить это действие`);
  }
  private visibleConversationIds() {
    const a = this.actor();
    return new Set(this.conversations.filter((c) => canSee(a, c)).map((c) => c.id));
  }
  private evaluationVisible(evaluationId: string) {
    const ev = this.evaluations.find((e) => e.id === evaluationId);
    return !!ev && this.visibleConversationIds().has(ev.conversationId);
  }
  /** Reviewer activity on an evaluation moves its dialog to "in review"; an explicit review of this evaluation stays. */
  private noteReviewActivity(evaluationId: string) {
    const a = this.actor();
    const ev = this.evaluations.find((e) => e.id === evaluationId);
    const conv = this.conversations.find((c) => c.id === ev?.conversationId);
    if (!ev || !conv || a.role === 'operator' || conv.review?.evaluationId === ev.id) return;
    conv.review = { status: 'in_review', evaluationId: ev.id, by: a.name, at: new Date().toISOString() };
  }

  async listConversations(query: { language?: Conversation['language']; channel?: Conversation['channel'] } = {}) {
    const a = this.actor();
    return later(
      this.conversations.filter((c) => canSee(a, c) && (!query.language || c.language === query.language) && (!query.channel || c.channel === query.channel)),
    );
  }

  async getConversation(id: string) {
    const c = this.conversations.find((x) => x.id === id);
    if (!c || !canSee(this.actor(), c)) throw new CqaApiError('not_found', `conversation ${id} not found`);
    return later(c);
  }

  async listEvaluations(query: { conversationId?: string } = {}) {
    const visible = this.visibleConversationIds();
    return later(this.evaluations.filter((e) => visible.has(e.conversationId) && (!query.conversationId || e.conversationId === query.conversationId)));
  }

  async getEvaluation(id: string) {
    const e = this.evaluations.find((x) => x.id === id);
    if (!e || !this.evaluationVisible(id)) throw new CqaApiError('not_found', `evaluation ${id} not found`);
    return later(e);
  }

  async setReview(conversationId: string, input: SetReviewInput) {
    this.require('review');
    const parsed = SetReviewInputSchema.safeParse(input);
    if (!parsed.success) throw new CqaApiError('invalid', parsed.error.message);
    const conv = this.conversations.find((c) => c.id === conversationId);
    if (!conv) throw new CqaApiError('not_found', `conversation ${conversationId} not found`);
    if (parsed.data.status === 'new') delete conv.review;
    else {
      const latest = [...this.evaluations].reverse().find((e) => e.conversationId === conversationId);
      if (!latest) throw new CqaApiError('conflict', 'Диалог ещё не оценён: проверять пока нечего');
      conv.review = { status: parsed.data.status, evaluationId: latest.id, by: this.actor().name, at: new Date().toISOString() };
    }
    return later(conv);
  }

  async assignOperator(input: AssignOperatorInput) {
    this.require('assign');
    const parsed = AssignOperatorInputSchema.safeParse(input);
    if (!parsed.success) throw new CqaApiError('invalid', parsed.error.message);
    const targets = parsed.data.conversationIds.map((id) => this.conversations.find((c) => c.id === id));
    if (targets.some((c) => !c)) throw new CqaApiError('not_found', 'conversation not found');
    for (const c of targets) c!.operatorId = parsed.data.operator;
  }

  async listOperators() {
    return later([...new Set(this.conversations.map((c) => c.operatorId).filter((o): o is string => !!o))].sort((a, b) => a.localeCompare(b, 'ru')));
  }

  async listChecklists() {
    return later(this.checklists);
  }

  /** Each save is a NEW immutable version (version = previous max + 1); old versions are untouched. */
  async saveChecklistVersion(input: unknown) {
    this.require('editChecklist');
    const parsed = SaveChecklistInputSchema.safeParse(input);
    if (!parsed.success) throw new CqaApiError('invalid', parsed.error.message);
    const version = Math.max(0, ...this.checklists.map((c) => c.version)) + 1;
    const saved: ChecklistVersion = { ...clone(parsed.data), id: `checklist-v${version}`, version, createdAt: new Date().toISOString() };
    this.checklists.push(saved);
    return later(saved);
  }

  /** Completes immediately. Evaluates against the requested checklist's own criteria with placeholder results. */
  async startEvaluation(input: unknown) {
    this.require('evaluate');
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
        createdAt: new Date().toISOString(),
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

  async listAppeals(query: { evaluationId?: string; status?: Appeal['status'] } = {}) {
    return later(this.appeals.filter((a) => this.evaluationVisible(a.evaluationId) && (!query.evaluationId || a.evaluationId === query.evaluationId) && (!query.status || a.status === query.status)));
  }

  async createAppeal(input: unknown) {
    this.require('appeal');
    const parsed = CreateAppealInputSchema.safeParse(input);
    if (!parsed.success) throw new CqaApiError('invalid', parsed.error.message);
    const ev = this.evaluations.find((e) => e.id === parsed.data.evaluationId);
    if (!ev || !this.evaluationVisible(ev.id)) throw new CqaApiError('not_found', `evaluation ${parsed.data.evaluationId} not found`);
    if (this.appeals.some((a) => a.evaluationId === ev.id && a.criterionId === parsed.data.criterionId && a.status === 'pending')) throw new CqaApiError('conflict', 'a pending appeal already exists for this criterion');
    if (!ev.originalResults.some((r) => r.criterionId === parsed.data.criterionId)) {
      throw new CqaApiError('invalid', `criterion ${parsed.data.criterionId} is not part of this evaluation`);
    }
    const appeal: Appeal = { id: this.nextId('appeal-mock'), ...parsed.data, kind: 'appeal', status: 'pending', createdAt: new Date().toISOString(), createdBy: this.actor().name };
    this.appeals.push(appeal);
    return later(appeal);
  }

  /**
   * Same rule as the API (apps/api/src/services/appeals.ts applyOverride): rewrites finalResults + finalTotal only;
   * originalResults/originalTotal are never touched. The result carries the reviewer's reason and source 'reviewer'.
   */
  private applyOverride(evaluationId: string, criterionId: string, d: { reason: string; value?: CriterionValue | null; isNA?: boolean }) {
    const ev = this.evaluations.find((e) => e.id === evaluationId);
    if (!ev) throw new CqaApiError('not_found', `evaluation ${evaluationId} not found`);
    if (ev.status !== 'completed') throw new CqaApiError('conflict', 'only a completed evaluation can be changed');
    const checklist = this.checklists.find((c) => c.id === ev.checklistVersionId)!;
    const idx = ev.finalResults.findIndex((r) => r.criterionId === criterionId);
    if (idx < 0) throw new CqaApiError('invalid', `criterion ${criterionId} is not part of this evaluation`);
    const isNA = d.isNA === true;
    const value = isNA ? null : (d.value ?? null);
    const next = clone(ev.finalResults);
    const { confidence: _c, reusedFrom: _r, naReason: _n, ...rest } = next[idx]!;
    next[idx] = { ...rest, value, isNA, ...(isNA ? { naReason: d.reason } : {}), explanation: d.reason, source: 'reviewer' };
    let scored;
    try {
      scored = scoreEvaluation(checklist, next); // rejects disallowed values / N/A before anything is mutated
    } catch (e) {
      throw new CqaApiError('invalid', e instanceof Error ? e.message : 'invalid override');
    }
    ev.finalResults = next;
    ev.finalTotal = scored.total;
    ev.seriousViolation = scored.seriousViolation;
    return { value, isNA };
  }

  async decideAppeal(input: unknown) {
    this.require('decide');
    const parsed = DecideAppealInputSchema.safeParse(input);
    if (!parsed.success) throw new CqaApiError('invalid', parsed.error.message);
    const d = parsed.data;
    const appeal = this.appeals.find((a) => a.id === d.appealId);
    if (!appeal) throw new CqaApiError('not_found', `appeal ${d.appealId} not found`);
    if (appeal.status !== 'pending') throw new CqaApiError('conflict', `appeal ${appeal.id} is already ${appeal.status}`);
    if (d.action === 'override') {
      const { value, isNA } = this.applyOverride(appeal.evaluationId, appeal.criterionId, d);
      appeal.status = 'overridden';
      appeal.reviewerValue = value;
      appeal.reviewerIsNA = isNA;
    } else {
      appeal.status = 'upheld';
    }
    appeal.decidedAt = new Date().toISOString();
    appeal.decidedBy = this.actor().name;
    appeal.reviewerReason = d.reason;
    this.noteReviewActivity(appeal.evaluationId);
    return later(appeal);
  }

  /** Fictional data: whatever the fixture links is played as it is. */
  audioSrc(conversation: Conversation) {
    return conversation.audioUrl;
  }

  async overrideCriterion(input: unknown) {
    this.require('correct');
    const parsed = OverrideCriterionInputSchema.safeParse(input);
    if (!parsed.success) throw new CqaApiError('invalid', parsed.error.message);
    const d = parsed.data;
    if (this.appeals.some((a) => a.evaluationId === d.evaluationId && a.criterionId === d.criterionId && a.status === 'pending')) {
      throw new CqaApiError('conflict', 'this criterion has a pending appeal: decide the appeal instead');
    }
    const { value, isNA } = this.applyOverride(d.evaluationId, d.criterionId, d);
    const now = new Date().toISOString();
    const appeal: Appeal = { id: this.nextId('appeal-mock'), evaluationId: d.evaluationId, criterionId: d.criterionId, kind: 'correction', comment: '', status: 'overridden', createdAt: now, createdBy: this.actor().name, decidedBy: this.actor().name, decidedAt: now, reviewerReason: d.reason, reviewerValue: value, reviewerIsNA: isNA };
    this.appeals.push(appeal);
    this.noteReviewActivity(d.evaluationId);
    return later(appeal);
  }
}
