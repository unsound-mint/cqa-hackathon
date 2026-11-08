import { z } from 'zod';
import { RoleSchema } from './roles.js';
import { CriterionValueSchema } from './domain.js';

/** People, teams, the event log, coaching comments, QA tasks, cross-checks, error tags and the timeline. See docs/ARCHITECTURE.md §6. */

export const PersonSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  role: RoleSchema,
  /** Operators belong to a team; a manager leads one (Team.managerId). */
  teamId: z.string().nullable(),
});
export type Person = z.infer<typeof PersonSchema>;

export const TeamSchema = z.object({ id: z.string().min(1).max(80), name: z.string().trim().min(1).max(80), managerId: z.string().nullable() });
export type Team = z.infer<typeof TeamSchema>;

export const DirectorySchema = z.object({ people: z.array(PersonSchema), teams: z.array(TeamSchema) });
export type Directory = z.infer<typeof DirectorySchema>;

// ---------- event log ----------

export const EventTypeSchema = z.enum([
  'review.set',
  'result.corrected',
  'appeal.filed',
  'appeal.decided',
  'operator.assigned',
  'checklist.saved',
  'comment.added',
  'comment.acknowledged',
  'task.created',
  'task.done',
  'crosscheck.submitted',
  'tag.added',
  'timeline.added',
  'directory.changed',
  'taxonomy.changed',
  'data.imported',
  'evaluation.started',
]);
export type EventType = z.infer<typeof EventTypeSchema>;

/** Append-only: one row per human action, never edited. */
export const EventSchema = z.object({
  id: z.string().min(1),
  at: z.string(),
  actorId: z.string().optional(),
  actorName: z.string(),
  actorRole: RoleSchema.optional(),
  type: EventTypeSchema,
  conversationId: z.string().optional(),
  /** One line a person can read in the log. */
  summary: z.string(),
  /** Machine-readable detail (status, criterion, values) for the monitors. */
  data: z.record(z.string(), z.unknown()).optional(),
});
export type AuditEvent = z.infer<typeof EventSchema>;

export const ListEventsQuerySchema = z.object({
  type: EventTypeSchema.optional(),
  actorId: z.string().optional(),
  conversationId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});
export type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;

// ---------- notifications ----------

export const NotificationKindSchema = z.enum(['critical', 'comment', 'appeal', 'task', 'crosscheck']);
export const NotificationSchema = z.object({
  id: z.string().min(1),
  at: z.string(),
  recipientId: z.string(),
  kind: NotificationKindSchema,
  title: z.string(),
  body: z.string(),
  conversationId: z.string().optional(),
  criterionId: z.string().optional(),
  readAt: z.string().optional(),
});
export type Notification = z.infer<typeof NotificationSchema>;

// ---------- coaching comments ----------

export const CommentSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  criterionId: z.string().optional(),
  authorId: z.string().optional(),
  authorName: z.string(),
  body: z.string().min(1),
  createdAt: z.string(),
  /** The operator's «ознакомлен». */
  ackedAt: z.string().optional(),
});
export type Comment = z.infer<typeof CommentSchema>;
export const AddCommentInputSchema = z.object({ conversationId: z.string().min(1), criterionId: z.string().min(1).optional(), body: z.string().trim().min(1).max(2000) });
export type AddCommentInput = z.infer<typeof AddCommentInputSchema>;

// ---------- QA tasks and cross-checks ----------

export const TaskKindSchema = z.enum(['review', 'crosscheck']);
export const TaskSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  assigneeId: z.string().min(1),
  kind: TaskKindSchema,
  status: z.enum(['open', 'done', 'cancelled']),
  /** True when the system picked the assignee (least open work). */
  auto: z.boolean(),
  createdBy: z.string(),
  createdAt: z.string(),
  doneAt: z.string().optional(),
  /** For a cross-check: whoever reviewed the dialog first; the checker is never the same person. */
  firstReviewerId: z.string().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

/** `assigneeId` absent = the system picks the QA person with the fewest open tasks. */
export const CreateTasksInputSchema = z.object({ conversationIds: z.array(z.string().min(1)).min(1).max(500), kind: TaskKindSchema, assigneeId: z.string().min(1).optional() });
export type CreateTasksInput = z.infer<typeof CreateTasksInputSchema>;

/** Random sample of reviewed dialogs for a second, blind check. */
export const SampleCrosschecksInputSchema = z.object({ percent: z.number().int().min(1).max(100) });
export type SampleCrosschecksInput = z.infer<typeof SampleCrosschecksInputSchema>;

export const CrosscheckResultSchema = z.object({ criterionId: z.string().min(1), value: CriterionValueSchema.nullable(), isNA: z.boolean() });
export const CrosscheckSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  conversationId: z.string().min(1),
  evaluationId: z.string().min(1),
  reviewerId: z.string().optional(),
  reviewerName: z.string(),
  reviewerRole: z.string(),
  results: z.array(CrosscheckResultSchema).min(1),
  submittedAt: z.string(),
});
export type Crosscheck = z.infer<typeof CrosscheckSchema>;
export const SubmitCrosscheckInputSchema = z.object({ taskId: z.string().min(1), results: z.array(CrosscheckResultSchema).min(1) });
export type SubmitCrosscheckInput = z.infer<typeof SubmitCrosscheckInputSchema>;

// ---------- error tags ----------

/** Where the problem lives: the operator, a bank process, a rule that is unclear, or a tool. Not every error is the operator's. */
export const ErrorOriginSchema = z.enum(['operator', 'process', 'rule', 'tool']);
export type ErrorOrigin = z.infer<typeof ErrorOriginSchema>;
export const ERROR_ORIGIN_LABELS: Record<ErrorOrigin, string> = { operator: 'Оператор', process: 'Процесс банка', rule: 'Правило неясно', tool: 'Инструмент' };

export const TaxonomyItemSchema = z.object({ id: z.string().min(1), label: z.string().trim().min(1).max(80), criterionId: z.string().optional() });
export type TaxonomyItem = z.infer<typeof TaxonomyItemSchema>;
export const SaveTaxonomyItemInputSchema = z.object({ label: z.string().trim().min(1).max(80), criterionId: z.string().min(1).optional() });

/** Non-scoring: tags never change a grade. */
export const TagSchema = z.object({
  id: z.string().min(1),
  evaluationId: z.string().min(1),
  conversationId: z.string().min(1),
  criterionId: z.string().optional(),
  origin: ErrorOriginSchema,
  label: z.string().optional(),
  by: z.string(),
  at: z.string(),
});
export type Tag = z.infer<typeof TagSchema>;
export const AddTagInputSchema = z.object({ evaluationId: z.string().min(1), criterionId: z.string().min(1).optional(), origin: ErrorOriginSchema, label: z.string().trim().min(1).max(80).optional() });
export type AddTagInput = z.infer<typeof AddTagInputSchema>;

// ---------- timeline ----------

export const TimelineKindSchema = z.enum(['training', 'policy', 'other']);
export const TimelineEventSchema = z.object({
  id: z.string().min(1),
  /** ISO date (YYYY-MM-DD). */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().trim().min(1).max(120),
  kind: TimelineKindSchema,
  note: z.string().optional(),
  /** Who took part (a training) and the comparison cohort that did not: the effect is measured between them. */
  participantIds: z.array(z.string()),
  comparisonIds: z.array(z.string()),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
export const SaveTimelineEventInputSchema = TimelineEventSchema.pick({ date: true, title: true, kind: true, participantIds: true, comparisonIds: true }).extend({ note: z.string().max(1000).optional() });
export type SaveTimelineEventInput = z.infer<typeof SaveTimelineEventInputSchema>;
