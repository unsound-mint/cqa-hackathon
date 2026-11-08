import type {
  AddCommentInput,
  AddTagInput,
  AuditEvent,
  Comment,
  CreateTasksInput,
  Crosscheck,
  Directory,
  ListEventsQuery,
  Notification,
  Person,
  SaveTimelineEventInput,
  SubmitCrosscheckInput,
  Tag,
  Task,
  TaxonomyItem,
  Team,
  TimelineEvent,
  Appeal,
  AssignOperatorInput,
  ChecklistVersion,
  Conversation,
  CreateAppealInput,
  DecideAppealInput,
  Evaluation,
  Job,
  ListAppealsQuery,
  ListConversationsQuery,
  ListEvaluationsQuery,
  OverrideCriterionInput,
  SaveChecklistInput,
  SetReviewInput,
  StartEvaluationInput,
} from '@cqa/contracts';

/**
 * Service contract between UI and backend. Components depend only on this interface; MockCqaApi
 * (fictional fixture) and a future HttpCqaApi implement it. Route mapping: docs/ARCHITECTURE.md.
 */
export interface CqaApi {
  listConversations(query?: ListConversationsQuery): Promise<Conversation[]>;
  getConversation(id: string): Promise<Conversation>;
  listEvaluations(query?: ListEvaluationsQuery): Promise<Evaluation[]>;
  getEvaluation(id: string): Promise<Evaluation>;
  listChecklists(): Promise<ChecklistVersion[]>;
  saveChecklistVersion(input: SaveChecklistInput): Promise<ChecklistVersion>;
  startEvaluation(input: StartEvaluationInput): Promise<{ jobId: string }>;
  getJob(id: string): Promise<Job>;
  /** One evaluation's appeals, or (no evaluationId) all appeals across dialogs, optionally only one status. */
  listAppeals(query?: ListAppealsQuery): Promise<Appeal[]>;
  createAppeal(input: CreateAppealInput): Promise<Appeal>;
  decideAppeal(input: DecideAppealInput): Promise<Appeal>;
  /** A reviewer corrects one criterion directly; recorded as an already-decided appeal of kind 'correction'. */
  overrideCriterion(input: OverrideCriterionInput): Promise<Appeal>;
  /** Mark a dialog in review / reviewed, or `new` to reopen it; answers the dialog with its review. */
  setReview(conversationId: string, input: SetReviewInput): Promise<Conversation>;
  /** The lead assigns dialogs to an operator (null unassigns). */
  assignOperator(input: AssignOperatorInput): Promise<void>;
  /** People and teams: the role picker, assignment and team scoping come from it. */
  getDirectory(): Promise<Directory>;
  savePerson(person: Person): Promise<Person>;
  saveTeam(team: Team): Promise<Team>;
  /** Fictional organisation for demos, only into an empty directory. */
  seedDemoOrg(): Promise<{ people: number; assigned: number }>;
  /** The audit log, newest first (top managers and admins). */
  listEvents(query?: ListEventsQuery): Promise<AuditEvent[]>;
  listNotifications(): Promise<Notification[]>;
  markNotificationsRead(ids?: string[]): Promise<void>;
  listComments(): Promise<Comment[]>;
  addComment(input: AddCommentInput): Promise<Comment>;
  acknowledgeComment(id: string): Promise<Comment>;
  listTaxonomy(): Promise<TaxonomyItem[]>;
  addTaxonomyItem(input: { label: string; criterionId?: string }): Promise<TaxonomyItem>;
  listTags(): Promise<Tag[]>;
  addTag(input: AddTagInput): Promise<Tag>;
  listTimeline(): Promise<TimelineEvent[]>;
  addTimelineEvent(input: SaveTimelineEventInput): Promise<TimelineEvent>;
  listTasks(): Promise<Task[]>;
  createTasks(input: CreateTasksInput): Promise<Task[]>;
  sampleCrosschecks(percent: number): Promise<Task[]>;
  cancelTask(id: string): Promise<Task>;
  listCrosschecks(): Promise<Crosscheck[]>;
  submitCrosscheck(input: SubmitCrosscheckInput): Promise<Crosscheck>;
  /** What an <audio> element plays for a call: the API resolves the organizer's player page to the media file. */
  audioSrc(conversation: Conversation): string | null;
}

export type CqaApiErrorCode = 'not_found' | 'invalid' | 'conflict' | 'forbidden';

export class CqaApiError extends Error {
  constructor(
    public readonly code: CqaApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CqaApiError';
  }
}
