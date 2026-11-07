import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
