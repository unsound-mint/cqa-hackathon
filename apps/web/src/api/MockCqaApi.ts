import {
  DemoBundleSchema,
  SaveChecklistInputSchema,
  CreateAppealInputSchema,
  DecideAppealInputSchema,
  OverrideCriterionInputSchema,
  StartEvaluationInputSchema,
  AssignOperatorInputSchema,
  ROLE_LABELS,
  AddCommentInputSchema,
  AddTagInputSchema,
  CreateTasksInputSchema,
  PersonSchema,
  SaveTimelineEventInputSchema,
  SubmitCrosscheckInputSchema,
  TeamSchema,
  SetReviewInputSchema,
  can,
  canSee,
  operatorScope,
  scoreEvaluation,
  type Actor,
  type AddCommentInput,
  type AddTagInput,
  type AuditEvent,
  type Comment,
  type CreateTasksInput,
  type Crosscheck,
  type Directory,
  type EventType,
  type ListEventsQuery,
  type Notification,
  type Person,
  type SaveTimelineEventInput,
  type Scope,
  type SubmitCrosscheckInput,
  type Tag,
  type Task,
  type TaxonomyItem,
  type Team,
  type TimelineEvent,
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

/** Everything beyond dialogs and evaluations that the mock starts with: people, teams, comments, tasks, the timeline... (all fictional). */
export type OrgSeed = Partial<{ directory: Directory; comments: Comment[]; tags: Tag[]; tasks: Task[]; crosschecks: Crosscheck[]; events: AuditEvent[]; timeline: TimelineEvent[]; taxonomy: TaxonomyItem[]; notifications: Notification[] }>;

export class MockCqaApi implements CqaApi {
  private directory: Directory = { people: [], teams: [] };
  private comments: Comment[] = [];
  private tags: Tag[] = [];
  private tasks: Task[] = [];
  private crosschecks: Crosscheck[] = [];
  private events: AuditEvent[] = [];
  private timeline: TimelineEvent[] = [];
  private taxonomy: TaxonomyItem[] = [];
  private notifications: Notification[] = [];

  private conversations: Conversation[];
  private checklists: ChecklistVersion[];
  private evaluations: Evaluation[];
  private jobs = new Map<string, Job>();
  private appeals: Appeal[];
  private seq = 0;

  constructor(bundle: unknown = demoJson, seedAppeals: Appeal[] = [], org: OrgSeed = {}) {
    const b = DemoBundleSchema.parse(bundle);
    this.conversations = clone(b.conversations);
    this.checklists = clone(b.checklists);
    this.evaluations = clone(b.evaluations);
    this.appeals = clone(seedAppeals);
    this.directory = clone(org.directory ?? this.directory);
    this.comments = clone(org.comments ?? []);
    this.tags = clone(org.tags ?? []);
    this.tasks = clone(org.tasks ?? []);
    this.crosschecks = clone(org.crosschecks ?? []);
    this.events = clone(org.events ?? []);
    this.timeline = clone(org.timeline ?? []);
    this.taxonomy = clone(org.taxonomy ?? []);
    this.notifications = clone(org.notifications ?? []);
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
  /** Least privilege, as in the API: an operator sees themselves, a manager their team, others everything. */
  private scope(): Scope {
    return operatorScope(this.actor(), this.directory.people, this.directory.teams);
  }
  private visibleConversationIds() {
    const s = this.scope();
    return new Set(this.conversations.filter((c) => canSee(s, c)).map((c) => c.id));
  }
  /** Appends to the audit log, like the API does inside each action's transaction. */
  private log(type: EventType, summary: string, conversationId?: string, data?: Record<string, unknown>) {
    const a = this.actor();
    this.events.unshift({ id: this.nextId('ev-mock'), at: new Date().toISOString(), actorName: a.name || 'без имени', actorRole: a.role, ...(a.id ? { actorId: a.id } : {}), type, summary, ...(conversationId ? { conversationId } : {}), ...(data ? { data } : {}) });
  }
  private notify(recipientIds: (string | undefined)[], n: Pick<Notification, 'kind' | 'title' | 'body'> & { conversationId?: string; criterionId?: string }) {
    for (const recipientId of new Set(recipientIds.filter((x): x is string => !!x))) this.notifications.unshift({ id: this.nextId('n-mock'), at: new Date().toISOString(), recipientId, ...n });
  }
  private managerOf(operatorId: string | null | undefined) {
    const team = this.directory.teams.find((t) => t.id === this.directory.people.find((p) => p.id === operatorId)?.teamId);
    return team?.managerId ?? undefined;
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
    const s = this.scope();
    return later(
      this.conversations.filter((c) => canSee(s, c) && (!query.language || c.language === query.language) && (!query.channel || c.channel === query.channel)),
    );
  }

  async getConversation(id: string) {
    const c = this.conversations.find((x) => x.id === id);
    if (!c || !canSee(this.scope(), c)) throw new CqaApiError('not_found', `conversation ${id} not found`);
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
    if (parsed.data.status === 'new') {
      delete conv.review;
      this.log('review.set', 'Диалог возвращён в новые', conversationId, { status: 'new' });
    } else {
      const latest = [...this.evaluations].reverse().find((e) => e.conversationId === conversationId && e.status === 'completed');
      if (!latest) throw new CqaApiError('conflict', 'Диалог ещё не оценён: проверять пока нечего');
      const a = this.actor();
      conv.review = { status: parsed.data.status, evaluationId: latest.id, by: a.name, at: new Date().toISOString() };
      this.log('review.set', parsed.data.status === 'reviewed' ? 'Диалог отмечен проверенным' : 'Диалог взят в работу', conversationId, { status: parsed.data.status, evaluationId: latest.id });
      if (parsed.data.status === 'reviewed' && a.id) for (const t of this.tasks) if (t.conversationId === conversationId && t.kind === 'review' && t.assigneeId === a.id && t.status === 'open') Object.assign(t, { status: 'done', doneAt: new Date().toISOString() });
    }
    return later(conv);
  }

  async assignOperator(input: AssignOperatorInput) {
    this.require('assign');
    const parsed = AssignOperatorInputSchema.safeParse(input);
    if (!parsed.success) throw new CqaApiError('invalid', parsed.error.message);
    const targets = parsed.data.conversationIds.map((id) => this.conversations.find((c) => c.id === id));
    if (targets.some((c) => !c)) throw new CqaApiError('not_found', 'conversation not found');
    const person = parsed.data.operator === null ? undefined : this.directory.people.find((p) => p.id === parsed.data.operator && p.role === 'operator');
    if (parsed.data.operator !== null && !person) throw new CqaApiError('invalid', 'unknown operator: add the person to the directory first');
    for (const c of targets) c!.operatorId = parsed.data.operator;
    this.log('operator.assigned', person ? `Диалоги назначены оператору ${person.name}: ${targets.length}` : `Оператор снят с диалогов: ${targets.length}`, undefined, { count: targets.length, operator: parsed.data.operator });
  }

  async getDirectory() {
    return later(this.directory);
  }
  async savePerson(input: Person) {
    this.require('manageTeams');
    const p = PersonSchema.parse(input);
    this.directory.people = [...this.directory.people.filter((x) => x.id !== p.id), p];
    this.log('directory.changed', `Сотрудник «${p.name}» сохранён`);
    return later(p);
  }
  async saveTeam(input: Team) {
    this.require('manageTeams');
    const t = TeamSchema.parse(input);
    this.directory.teams = [...this.directory.teams.filter((x) => x.id !== t.id), t];
    this.log('directory.changed', `Группа «${t.name}» сохранена`);
    return later(t);
  }
  /** The fictional organisation lives in demoOrg.ts (mock mode seeds it at start); here only the API's "empty directory" rule. */
  async seedDemoOrg(): Promise<{ people: number; assigned: number }> {
    this.require('manageTeams');
    throw new CqaApiError('conflict', 'the directory is not empty');
  }
  async listEvents(query: ListEventsQuery = {}) {
    this.require('audit');
    return later(this.events.filter((e) => (!query.type || e.type === query.type) && (!query.actorId || e.actorId === query.actorId) && (!query.conversationId || e.conversationId === query.conversationId)).slice(0, query.limit ?? 1000));
  }
  async listNotifications() {
    const id = this.actor().id;
    return later(id ? this.notifications.filter((n) => n.recipientId === id) : []);
  }
  async markNotificationsRead(ids?: string[]) {
    const id = this.actor().id;
    for (const n of this.notifications) if (n.recipientId === id && !n.readAt && (!ids || ids.includes(n.id))) n.readAt = new Date().toISOString();
  }
  private operatorOf = (conversationId: string) => this.conversations.find((c) => c.id === conversationId)?.operatorId ?? undefined;
  private requireVisible(conversationId: string) {
    const c = this.conversations.find((x) => x.id === conversationId);
    if (!c || !canSee(this.scope(), c)) throw new CqaApiError('not_found', `conversation ${conversationId} not found`);
    return c;
  }
  async listComments() {
    const s = this.scope();
    return later(this.comments.filter((c) => canSee(s, { operatorId: this.operatorOf(c.conversationId) })));
  }
  async addComment(input: AddCommentInput) {
    this.require('comment');
    const p = AddCommentInputSchema.safeParse(input);
    if (!p.success) throw new CqaApiError('invalid', p.error.message);
    this.requireVisible(p.data.conversationId);
    const a = this.actor();
    const c: Comment = { id: this.nextId('c-mock'), conversationId: p.data.conversationId, ...(p.data.criterionId ? { criterionId: p.data.criterionId } : {}), ...(a.id ? { authorId: a.id } : {}), authorName: a.name, body: p.data.body, createdAt: new Date().toISOString() };
    this.comments.push(c);
    this.log('comment.added', `Комментарий${c.criterionId ? ` к критерию ${c.criterionId}` : ' к диалогу'}`, c.conversationId, { commentId: c.id });
    this.notify([this.operatorOf(c.conversationId)], { kind: 'comment', title: `Комментарий к диалогу ${c.conversationId}`, body: c.body.slice(0, 200), conversationId: c.conversationId });
    return later(c);
  }
  async acknowledgeComment(id: string) {
    const c = this.comments.find((x) => x.id === id);
    if (!c) throw new CqaApiError('not_found', 'comment not found');
    const a = this.actor();
    if (a.role !== 'operator' || (a.id ?? a.name) !== this.operatorOf(c.conversationId)) throw new CqaApiError('forbidden', 'Подтвердить ознакомление может только оператор этого диалога');
    if (!c.ackedAt) {
      c.ackedAt = new Date().toISOString();
      this.log('comment.acknowledged', 'Комментарий прочитан оператором', c.conversationId, { commentId: id });
    }
    return later(c);
  }
  async listTaxonomy() {
    return later(this.taxonomy);
  }
  async addTaxonomyItem(input: { label: string; criterionId?: string }) {
    this.require('editTaxonomy');
    if (this.taxonomy.some((t) => t.label === input.label && t.criterionId === input.criterionId)) throw new CqaApiError('conflict', 'this category already exists');
    const t: TaxonomyItem = { id: this.nextId('tx-mock'), label: input.label.trim(), ...(input.criterionId ? { criterionId: input.criterionId } : {}) };
    this.taxonomy.push(t);
    this.log('taxonomy.changed', `Категория ошибок «${t.label}» добавлена`);
    return later(t);
  }
  async listTags() {
    const s = this.scope();
    return later(this.tags.filter((t) => canSee(s, { operatorId: this.operatorOf(t.conversationId) })));
  }
  async addTag(input: AddTagInput) {
    this.require('tag');
    const p = AddTagInputSchema.safeParse(input);
    if (!p.success) throw new CqaApiError('invalid', p.error.message);
    const ev = this.evaluations.find((e) => e.id === p.data.evaluationId);
    if (!ev) throw new CqaApiError('not_found', `evaluation ${p.data.evaluationId} not found`);
    this.requireVisible(ev.conversationId);
    const t: Tag = { id: this.nextId('tag-mock'), evaluationId: ev.id, conversationId: ev.conversationId, ...(p.data.criterionId ? { criterionId: p.data.criterionId } : {}), origin: p.data.origin, ...(p.data.label ? { label: p.data.label } : {}), by: this.actor().name, at: new Date().toISOString() };
    this.tags.push(t);
    this.log('tag.added', `Причина ошибки: ${t.label ?? t.origin}`, ev.conversationId, { criterionId: t.criterionId, origin: t.origin });
    return later(t);
  }
  async listTimeline() {
    return later(this.timeline);
  }
  async addTimelineEvent(input: SaveTimelineEventInput) {
    this.require('timeline');
    const p = SaveTimelineEventInputSchema.safeParse(input);
    if (!p.success) throw new CqaApiError('invalid', p.error.message);
    const t: TimelineEvent = { id: this.nextId('tl-mock'), ...p.data, createdBy: this.actor().name, createdAt: new Date().toISOString() };
    this.timeline = [...this.timeline, t].sort((a, b) => a.date.localeCompare(b.date));
    this.log('timeline.added', `Событие на шкале: ${t.title} (${t.date})`);
    return later(t);
  }
  async listTasks() {
    const a = this.actor();
    return later(this.tasks.filter((t) => can(a, 'task') || t.assigneeId === a.id));
  }
  private openLoad = (personId: string) => this.tasks.filter((t) => t.assigneeId === personId && t.status === 'open').length;
  async createTasks(input: CreateTasksInput) {
    this.require('task');
    const p = CreateTasksInputSchema.safeParse(input);
    if (!p.success) throw new CqaApiError('invalid', p.error.message);
    const qa = this.directory.people.filter((x) => x.role === 'reviewer').map((x) => x.id);
    const assignable = new Set([...qa, ...this.directory.people.filter((x) => x.role === 'lead').map((x) => x.id)]);
    if (p.data.assigneeId && !assignable.has(p.data.assigneeId)) throw new CqaApiError('invalid', 'the assignee must be a QA person or a top manager');
    const created: Task[] = [];
    for (const conversationId of new Set(p.data.conversationIds)) {
      const conv = this.conversations.find((c) => c.id === conversationId);
      if (!conv) throw new CqaApiError('not_found', `conversation ${conversationId} not found`);
      if (this.tasks.some((t) => t.conversationId === conversationId && t.kind === p.data.kind && t.status === 'open')) continue;
      if (p.data.kind === 'crosscheck' && conv.review?.status !== 'reviewed') throw new CqaApiError('conflict', `dialog ${conversationId} must be reviewed before a cross-check`);
      const first = p.data.kind === 'crosscheck' ? this.directory.people.find((x) => x.name === conv.review?.by)?.id : undefined;
      const assigneeId = p.data.assigneeId ?? [...qa.filter((id) => id !== first)].sort((x, y) => this.openLoad(x) - this.openLoad(y) || x.localeCompare(y))[0];
      if (!assigneeId) throw new CqaApiError('conflict', 'no QA person available for this task');
      if (first && assigneeId === first) throw new CqaApiError('conflict', 'a cross-check cannot go to the person who reviewed the dialog');
      const t: Task = { id: this.nextId('task-mock'), conversationId, assigneeId, kind: p.data.kind, status: 'open', auto: !p.data.assigneeId, createdBy: this.actor().name, createdAt: new Date().toISOString(), ...(first ? { firstReviewerId: first } : {}) };
      this.tasks.push(t);
      this.log('task.created', `${t.kind === 'crosscheck' ? 'Контрольная проверка' : 'Проверка'} поручена${t.auto ? ' автоматически (по загрузке)' : ''}`, conversationId, { taskId: t.id, kind: t.kind, assigneeId, auto: t.auto });
      this.notify([assigneeId], { kind: 'task', title: t.kind === 'crosscheck' ? `Контрольная проверка: ${conversationId}` : `Новая задача: ${conversationId}`, body: 'Вам назначена проверка диалога.', conversationId });
      created.push(t);
    }
    return later(created);
  }
  async sampleCrosschecks(percent: number) {
    this.require('task');
    const taken = new Set(this.tasks.filter((t) => t.kind === 'crosscheck').map((t) => t.conversationId));
    const pool = this.conversations.filter((c) => c.review?.status === 'reviewed' && !taken.has(c.id)).map((c) => c.id);
    const n = Math.min(pool.length, Math.ceil((pool.length * percent) / 100));
    const out: Task[] = [];
    for (const id of pool.slice(0, n)) {
      try {
        out.push(...(await this.createTasks({ conversationIds: [id], kind: 'crosscheck' })));
      } catch (e) {
        if (!(e instanceof CqaApiError) || e.code !== 'conflict') throw e;
      }
    }
    return later(out);
  }
  async cancelTask(id: string) {
    this.require('task');
    const t = this.tasks.find((x) => x.id === id);
    if (!t) throw new CqaApiError('not_found', 'task not found');
    if (t.status !== 'open') throw new CqaApiError('conflict', `task is already ${t.status}`);
    Object.assign(t, { status: 'cancelled', doneAt: new Date().toISOString() });
    this.log('task.done', 'Задача отменена', t.conversationId, { taskId: id, cancelled: true });
    return later(t);
  }
  async listCrosschecks() {
    const a = this.actor();
    return later(this.crosschecks.filter((c) => can(a, 'task') || can(a, 'audit') || c.reviewerId === a.id));
  }
  async submitCrosscheck(input: SubmitCrosscheckInput) {
    this.require('crosscheck');
    const p = SubmitCrosscheckInputSchema.safeParse(input);
    if (!p.success) throw new CqaApiError('invalid', p.error.message);
    const task = this.tasks.find((t) => t.id === p.data.taskId && t.kind === 'crosscheck');
    if (!task) throw new CqaApiError('not_found', 'cross-check task not found');
    const a = this.actor();
    if (task.assigneeId !== a.id) throw new CqaApiError('forbidden', 'Эта контрольная проверка назначена другому человеку');
    if (task.status !== 'open') throw new CqaApiError('conflict', `task is already ${task.status}`);
    const ev = [...this.evaluations].reverse().find((e) => e.conversationId === task.conversationId && e.status === 'completed');
    const checklist = this.checklists.find((c) => c.id === ev?.checklistVersionId);
    if (!ev || !checklist) throw new CqaApiError('conflict', 'the dialog has no completed evaluation');
    for (const r of p.data.results) {
      const c = checklist.criteria.find((x) => x.id === r.criterionId);
      if (!c) throw new CqaApiError('invalid', `criterion ${r.criterionId} is not part of this evaluation`);
      if (r.isNA ? !c.allowNA : r.value === null || !c.allowedValues.includes(r.value)) throw new CqaApiError('invalid', `value is not allowed for criterion ${r.criterionId}`);
    }
    const now = new Date().toISOString();
    const cc: Crosscheck = { id: this.nextId('cc-mock'), taskId: task.id, conversationId: task.conversationId, evaluationId: ev.id, ...(a.id ? { reviewerId: a.id } : {}), reviewerName: a.name, reviewerRole: a.role, results: p.data.results, submittedAt: now };
    this.crosschecks.push(cc);
    Object.assign(task, { status: 'done', doneAt: now });
    this.log('crosscheck.submitted', 'Контрольная проверка выполнена', task.conversationId, { taskId: task.id, evaluationId: ev.id });
    return later(cc);
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
    const ids = [...new Set(parsed.data.conversationIds)].filter(id => !parsed.data.retryFailedOnly || [...this.evaluations].reverse().find(e => e.conversationId === id && e.checklistVersionId === checklist.id)?.status === 'failed');
    if (!ids.length) throw new CqaApiError('conflict', 'no failed conversations on this checklist to retry');
    for (const conversationId of ids) {
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
    this.jobs.set(jobId, { id: jobId, status: 'completed', succeeded: created.length, failed: 0, retrying: 0, completed: created.length, total: created.length, evaluationIds: created.map((e) => e.id) });
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
    this.log('appeal.filed', `Апелляция по критерию ${appeal.criterionId}`, ev.conversationId, { appealId: appeal.id, criterionId: appeal.criterionId });
    this.notify([this.managerOf(this.operatorOf(ev.conversationId))], { kind: 'appeal', title: `Апелляция: ${ev.conversationId}`, body: `Оператор оспорил критерий ${appeal.criterionId}.`, conversationId: ev.conversationId, criterionId: appeal.criterionId });
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
    const before = { value: ev.finalResults[idx]!.value, isNA: ev.finalResults[idx]!.isNA };
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
    this.log('result.corrected', `Изменена оценка критерия ${criterionId}`, ev.conversationId, { criterionId, before, after: { value, isNA }, evaluationId });
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
    const evc = this.evaluations.find((e) => e.id === appeal.evaluationId)?.conversationId;
    this.log('appeal.decided', `Апелляция по критерию ${appeal.criterionId}: ${d.action === 'uphold' ? 'оценка ИИ оставлена' : 'оценка изменена'}`, evc, { appealId: appeal.id, criterionId: appeal.criterionId, action: d.action });
    if (evc) this.notify([this.operatorOf(evc)], { kind: 'appeal', title: `Решение по апелляции: ${evc}`, body: `Критерий ${appeal.criterionId}: ${d.action === 'uphold' ? 'оценка ИИ оставлена' : 'оценка изменена'}. ${d.reason}`, conversationId: evc, criterionId: appeal.criterionId });
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
