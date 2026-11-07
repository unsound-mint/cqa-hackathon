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
  `);
  return drizzle(sqlite, { schema });
}

export { schema };
