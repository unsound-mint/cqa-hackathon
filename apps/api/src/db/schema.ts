import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** One row per conversation. `transcript` is the untouched message array (with added `index`) as JSON. */
export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    datasetGroupId: text('dataset_group_id').notNull(),
    language: text('language').notNull(),
    channel: text('channel').notNull(),
    audioUrl: text('audio_url'),
    transcript: text('transcript', { mode: 'json' }).notNull(),
    importedAt: text('imported_at').notNull(),
  },
  (t) => [index('conversations_group_idx').on(t.datasetGroupId)],
);

/** Immutable checklist versions: rows are only ever inserted. */
export const checklistVersions = sqliteTable('checklist_versions', {
  id: text('id').primaryKey(),
  version: integer('version').notNull().unique(),
  title: text('title').notNull(),
  sections: text('sections', { mode: 'json' }),
  criteria: text('criteria', { mode: 'json' }).notNull(),
  createdAt: text('created_at').notNull(),
});

/** originalResults/originalTotal are written once at creation and never updated. */
export const evaluations = sqliteTable('evaluations', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  checklistVersionId: text('checklist_version_id').notNull(),
  status: text('status').notNull(),
  originalResults: text('original_results', { mode: 'json' }).notNull(),
  originalTotal: real('original_total'),
  finalResults: text('final_results', { mode: 'json' }).notNull(),
  finalTotal: real('final_total'),
  seriousViolation: integer('serious_violation', { mode: 'boolean' }).notNull(),
  provenance: text('provenance', { mode: 'json' }),
  error: text('error'),
  cacheContext: text('cache_context'),
  decisionFacts: text('decision_facts', { mode: 'json' }),
  diagnostics: text('diagnostics', { mode: 'json' }),
  createdAt: text('created_at').notNull(),
});

/** Append-only audit trail: a decided appeal row is never rewritten. */
export const appeals = sqliteTable('appeals', {
  id: text('id').primaryKey(),
  evaluationId: text('evaluation_id').notNull(),
  criterionId: text('criterion_id').notNull(),
  /** 'appeal' | 'correction'; NULL on rows written before the column existed means 'appeal'. */
  kind: text('kind'),
  comment: text('comment').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by'),
  decidedBy: text('decided_by'),
  decidedAt: text('decided_at'),
  reviewerReason: text('reviewer_reason'),
  reviewerValue: text('reviewer_value', { mode: 'json' }),
  reviewerIsNA: integer('reviewer_is_na', { mode: 'boolean' }),
});

/** Evaluation batches. conversation_ids + checklist_version_id make a job resumable after a restart. */
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  checklistVersionId: text('checklist_version_id').notNull(),
  force: integer('force', { mode: 'boolean' }).notNull().default(false),
  maxAttempts: integer('max_attempts').notNull().default(1),
  conversationIds: text('conversation_ids', { mode: 'json' }).$type<string[]>().notNull(),
  evaluationIds: text('evaluation_ids', { mode: 'json' }).$type<string[]>().notNull(),
  status: text('status').notNull(),
  total: integer('total').notNull(),
  completed: integer('completed').notNull(),
  createdAt: text('created_at').notNull(),
});

/** Who a dialog is assigned to. Its own table: a re-import rewrites the conversation row and must not touch this. */
export const operatorAssignments = sqliteTable('operator_assignments', {
  conversationId: text('conversation_id').primaryKey(),
  operator: text('operator').notNull(),
  assignedBy: text('assigned_by'),
  assignedAt: text('assigned_at').notNull(),
});

/** A human's check of a dialog, bound to the evaluation that was looked at. Separate from the immutable evaluation. */
export const reviews = sqliteTable('reviews', {
  conversationId: text('conversation_id').primaryKey(),
  status: text('status').notNull(),
  evaluationId: text('evaluation_id').notNull(),
  by: text('by').notNull(),
  /** Person id of `by` (null for an unrestricted call): cross-checks must be by someone else. */
  byId: text('by_id'),
  at: text('at').notNull(),
});

export const people = sqliteTable('people', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  teamId: text('team_id'),
});

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  managerId: text('manager_id'),
});

/** Append-only: nothing in the app updates or deletes a row. */
export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    at: text('at').notNull(),
    actorId: text('actor_id'),
    actorName: text('actor_name').notNull(),
    actorRole: text('actor_role'),
    type: text('type').notNull(),
    conversationId: text('conversation_id'),
    summary: text('summary').notNull(),
    data: text('data', { mode: 'json' }),
  },
  (t) => [index('events_at_idx').on(t.at), index('events_conversation_idx').on(t.conversationId)],
);

export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  at: text('at').notNull(),
  recipientId: text('recipient_id').notNull(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  conversationId: text('conversation_id'),
  criterionId: text('criterion_id'),
  readAt: text('read_at'),
});

export const comments = sqliteTable('comments', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  criterionId: text('criterion_id'),
  authorId: text('author_id'),
  authorName: text('author_name').notNull(),
  body: text('body').notNull(),
  createdAt: text('created_at').notNull(),
  ackedAt: text('acked_at'),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  assigneeId: text('assignee_id').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  auto: integer('auto', { mode: 'boolean' }).notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  doneAt: text('done_at'),
  firstReviewerId: text('first_reviewer_id'),
});

export const crosschecks = sqliteTable('crosschecks', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  conversationId: text('conversation_id').notNull(),
  evaluationId: text('evaluation_id').notNull(),
  reviewerId: text('reviewer_id'),
  reviewerName: text('reviewer_name').notNull(),
  reviewerRole: text('reviewer_role').notNull(),
  results: text('results', { mode: 'json' }).notNull(),
  submittedAt: text('submitted_at').notNull(),
});

export const taxonomy = sqliteTable('taxonomy', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  criterionId: text('criterion_id'),
});

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  evaluationId: text('evaluation_id').notNull(),
  conversationId: text('conversation_id').notNull(),
  criterionId: text('criterion_id'),
  origin: text('origin').notNull(),
  label: text('label'),
  by: text('by').notNull(),
  at: text('at').notNull(),
});

export const timelineEvents = sqliteTable('timeline_events', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  title: text('title').notNull(),
  kind: text('kind').notNull(),
  note: text('note'),
  participantIds: text('participant_ids', { mode: 'json' }).$type<string[]>().notNull(),
  comparisonIds: text('comparison_ids', { mode: 'json' }).$type<string[]>().notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
});
