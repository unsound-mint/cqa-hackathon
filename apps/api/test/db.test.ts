import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/index.js';

describe('openDb', () => {
  it('adds the jobs.fresh column to a database created before it existed', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'cqa-db-')), 'old.sqlite');
    openDb(path); // current schema
    const raw = new Database(path);
    raw.exec('ALTER TABLE jobs DROP COLUMN fresh');
    raw.close();
    openDb(path); // must repair, not fail
    const check = new Database(path);
    expect((check.prepare('PRAGMA table_info(jobs)').all() as { name: string }[]).some((c) => c.name === 'fresh')).toBe(true);
    check.close();
  });
});
