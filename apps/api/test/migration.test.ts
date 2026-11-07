import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { openDb } from '../src/db/index.js';

it('upgrades a legacy database idempotently without losing prior evaluations or jobs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cqa-migration-'));
  try {
    const path = join(dir, 'legacy.sqlite');
    const first = openDb(path);
    first.$client.close();
    const legacy = new Database(path);
    legacy.exec(`
      ALTER TABLE evaluations DROP COLUMN cache_context;
      ALTER TABLE evaluations DROP COLUMN decision_facts;
      ALTER TABLE jobs DROP COLUMN force;
      INSERT INTO evaluations VALUES ('old', 'c', 'v', 'completed', '[]', 0, '[]', 0, 0, NULL, NULL, 'then');
      INSERT INTO jobs VALUES ('j', 'v', '["c"]', '["old"]', 'completed', 1, 1, 'then');
    `);
    legacy.close();
    for (let i = 0; i < 2; i++) {
      const upgraded = openDb(path);
      expect(upgraded.$client.prepare('SELECT cache_context FROM evaluations WHERE id = ?').get('old')).toEqual({cache_context:null});
      expect(upgraded.$client.prepare('SELECT decision_facts FROM evaluations WHERE id = ?').get('old')).toEqual({decision_facts:null});
      expect(upgraded.$client.prepare('SELECT force FROM jobs WHERE id = ?').get('j')).toEqual({force:0});
      upgraded.$client.close();
    }
  } finally { rmSync(dir, {recursive:true,force:true}); }
});
