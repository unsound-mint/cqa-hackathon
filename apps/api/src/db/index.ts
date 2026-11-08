import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type Db = ReturnType<typeof openDb>;

/** Opens (and creates) the SQLite file. `:memory:` for tests. DDL is idempotent; no migration tool yet. */
export function openDb(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY NOT NULL,
      dataset_group_id TEXT NOT NULL,
      language TEXT NOT NULL,
      channel TEXT NOT NULL,
      audio_url TEXT,
      transcript TEXT NOT NULL,
      imported_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS conversations_group_idx ON conversations (dataset_group_id);
    CREATE TABLE IF NOT EXISTS checklist_versions (
      id TEXT PRIMARY KEY NOT NULL,
      version INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      sections TEXT,
      criteria TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY NOT NULL,
      conversation_id TEXT NOT NULL,
      checklist_version_id TEXT NOT NULL,
      status TEXT NOT NULL,
      original_results TEXT NOT NULL,
      original_total REAL,
      final_results TEXT NOT NULL,
      final_total REAL,
      serious_violation INTEGER NOT NULL,
      provenance TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS evaluations_conversation_idx ON evaluations (conversation_id);
    CREATE TABLE IF NOT EXISTS appeals (
      id TEXT PRIMARY KEY NOT NULL,
      evaluation_id TEXT NOT NULL,
      criterion_id TEXT NOT NULL,
      kind TEXT,
      comment TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      decided_at TEXT,
      reviewer_reason TEXT,
      reviewer_value TEXT,
      reviewer_is_na INTEGER
    );
    CREATE INDEX IF NOT EXISTS appeals_evaluation_idx ON appeals (evaluation_id);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY NOT NULL,
      checklist_version_id TEXT NOT NULL,
      conversation_ids TEXT NOT NULL,
      evaluation_ids TEXT NOT NULL,
      status TEXT NOT NULL,
      total INTEGER NOT NULL,
      completed INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS operator_assignments (
      conversation_id TEXT PRIMARY KEY NOT NULL,
      operator TEXT NOT NULL,
      assigned_by TEXT,
      assigned_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS operator_assignments_operator_idx ON operator_assignments (operator);
    CREATE TABLE IF NOT EXISTS reviews (
      conversation_id TEXT PRIMARY KEY NOT NULL,
      status TEXT NOT NULL,
      evaluation_id TEXT NOT NULL,
      by TEXT NOT NULL,
      at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, team_id TEXT);
    CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, manager_id TEXT);
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY NOT NULL, at TEXT NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL, actor_role TEXT,
      type TEXT NOT NULL, conversation_id TEXT, summary TEXT NOT NULL, data TEXT
    );
    CREATE INDEX IF NOT EXISTS events_at_idx ON events (at);
    CREATE INDEX IF NOT EXISTS events_conversation_idx ON events (conversation_id);
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY NOT NULL, at TEXT NOT NULL, recipient_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
      body TEXT NOT NULL, conversation_id TEXT, criterion_id TEXT, read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications (recipient_id);
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT NOT NULL, criterion_id TEXT, author_id TEXT, author_name TEXT NOT NULL,
      body TEXT NOT NULL, created_at TEXT NOT NULL, acked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS comments_conversation_idx ON comments (conversation_id);
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT NOT NULL, assignee_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
      auto INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, done_at TEXT, first_reviewer_id TEXT
    );
    CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks (assignee_id);
    CREATE TABLE IF NOT EXISTS crosschecks (
      id TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL, conversation_id TEXT NOT NULL, evaluation_id TEXT NOT NULL, reviewer_id TEXT,
      reviewer_name TEXT NOT NULL, reviewer_role TEXT NOT NULL, results TEXT NOT NULL, submitted_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS taxonomy (id TEXT PRIMARY KEY NOT NULL, label TEXT NOT NULL, criterion_id TEXT);
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY NOT NULL, evaluation_id TEXT NOT NULL, conversation_id TEXT NOT NULL, criterion_id TEXT, origin TEXT NOT NULL,
      label TEXT, by TEXT NOT NULL, at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS timeline_events (
      id TEXT PRIMARY KEY NOT NULL, date TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, note TEXT,
      participant_ids TEXT NOT NULL, comparison_ids TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  // Additive migrations: CREATE TABLE IF NOT EXISTS does not add columns to an existing file. Legacy evaluations
  // intentionally have no reusable cache context; legacy appeal rows (no kind) read as 'appeal'.
  const columns = (table: string) => sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns('evaluations').some((c) => c.name === 'cache_context')) sqlite.exec('ALTER TABLE evaluations ADD COLUMN cache_context TEXT');
  if (!columns('evaluations').some((c) => c.name === 'decision_facts')) sqlite.exec('ALTER TABLE evaluations ADD COLUMN decision_facts TEXT');
  if (!columns('jobs').some((c) => c.name === 'force')) sqlite.exec('ALTER TABLE jobs ADD COLUMN force INTEGER NOT NULL DEFAULT 0');
  if (!columns('appeals').some((c) => c.name === 'kind')) sqlite.exec('ALTER TABLE appeals ADD COLUMN kind TEXT');
  if (!columns('appeals').some((c) => c.name === 'created_by')) sqlite.exec('ALTER TABLE appeals ADD COLUMN created_by TEXT');
  if (!columns('appeals').some((c) => c.name === 'decided_by')) sqlite.exec('ALTER TABLE appeals ADD COLUMN decided_by TEXT');
  if (!columns('reviews').some((c) => c.name === 'by_id')) sqlite.exec('ALTER TABLE reviews ADD COLUMN by_id TEXT');
  return drizzle(sqlite, { schema });
}

export { schema };
