import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  createdAt: text('created_at').notNull(),
});

/** Append-only audit trail: a decided appeal row is never rewritten. */
export const appeals = sqliteTable('appeals', {
  id: text('id').primaryKey(),
  evaluationId: text('evaluation_id').notNull(),
  criterionId: text('criterion_id').notNull(),
  comment: text('comment').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  decidedAt: text('decided_at'),
  reviewerReason: text('reviewer_reason'),
  reviewerValue: text('reviewer_value', { mode: 'json' }),
  reviewerIsNA: integer('reviewer_is_na', { mode: 'boolean' }),
});

/** Evaluation batches. conversation_ids + checklist_version_id make a job resumable after a restart. */
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  checklistVersionId: text('checklist_version_id').notNull(),
  conversationIds: text('conversation_ids', { mode: 'json' }).$type<string[]>().notNull(),
  evaluationIds: text('evaluation_ids', { mode: 'json' }).$type<string[]>().notNull(),
  status: text('status').notNull(),
  total: integer('total').notNull(),
  completed: integer('completed').notNull(),
  createdAt: text('created_at').notNull(),
});

/**
 * Human reference labels (docs/VALIDATION.md). PRIVATE: read only by the labeling page, the CSV export and the
 * comparison report; the evaluator must never read them (guarded by a test).
 */
export const humanLabels = sqliteTable(
  'human_labels',
  {
    conversationId: text('conversation_id').notNull(),
    criterionId: text('criterion_id').notNull(),
    value: text('value', { mode: 'json' }),
    isNA: integer('is_na', { mode: 'boolean' }).notNull(),
    evidence: text('evidence', { mode: 'json' }).$type<number[]>().notNull(),
    inspectedFrom: integer('inspected_from'),
    inspectedTo: integer('inspected_to'),
    rationale: text('rationale').notNull(),
    uncertainty: text('uncertainty').notNull(),
    reviewer: text('reviewer').notNull(),
    adjudicated: integer('adjudicated', { mode: 'boolean' }).notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.criterionId] })],
);

/** Append-only: every save or clear is kept, so original answers are never lost to later edits. */
export const humanLabelHistory = sqliteTable('human_label_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  conversationId: text('conversation_id').notNull(),
  criterionId: text('criterion_id').notNull(),
  action: text('action').notNull(),
  snapshot: text('snapshot', { mode: 'json' }),
  at: text('at').notNull(),
});
