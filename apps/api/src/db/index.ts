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
      comment TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      decided_at TEXT,
      reviewer_reason TEXT,
      reviewer_value TEXT,
      reviewer_is_na INTEGER
    );
    CREATE INDEX IF NOT EXISTS appeals_evaluation_idx ON appeals (evaluation_id);
  `);
  return drizzle(sqlite, { schema });
}

export { schema };
