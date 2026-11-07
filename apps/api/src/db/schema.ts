import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
