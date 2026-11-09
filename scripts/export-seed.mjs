// Rebuilds the committed DEV snapshot (data/seed/cqa-dev.db) from the live database. Usage: pnpm seed:export [--group DEV] [--db data/cqa.sqlite]
// Consistent copy via VACUUM INTO (safe while the server runs, includes WAL content), then everything outside the
// exported group is deleted from the COPY. The live database is only read.
//   - conversations: the group only (the control group never leaves local storage)
//   - evaluations: the latest completed one per conversation (latest failed if none completed), plus any evaluation
//     that a review, appeal, crosscheck or tag points at, so no reference dangles
//   - rows tied to a conversation (reviews, comments, tasks, ...) follow the conversations; people, teams, taxonomy,
//     checklist versions and timeline events are kept as is
//   - jobs and import/run journal events are dropped (they list ids and groups of runs, nothing to restore)
import { createRequire } from 'node:module';
import { mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'apps', 'api', 'package.json'));
const Database = require('better-sqlite3');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const group = arg('group', 'DEV');
const source = resolve(arg('db', join(root, 'data', 'cqa.sqlite')));
const target = join(root, 'data', 'seed', 'cqa-dev.db');
const tmp = `${target}.tmp`;

mkdirSync(dirname(target), { recursive: true });
rmSync(tmp, { force: true });
const live = new Database(source, { readonly: true });
live.prepare('VACUUM INTO ?').run(tmp);
live.close();

const db = new Database(tmp);
const hasTable = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
const run = (sql, ...p) => (hasTable(sql.match(/(?:FROM|UPDATE)\s+(\w+)/i)[1]) ? db.prepare(sql).run(...p).changes : 0);
db.transaction(() => {
  db.prepare('CREATE TEMP TABLE keep_conv AS SELECT id FROM conversations WHERE dataset_group_id = ?').run(group);
  db.exec(`CREATE TEMP TABLE keep_eval AS
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY (status = 'completed') DESC, created_at DESC, id DESC) AS rn
      FROM evaluations WHERE conversation_id IN (SELECT id FROM keep_conv)
    ) WHERE rn = 1`);
  const pinned = ['reviews', 'appeals', 'crosschecks', 'tags'].filter(hasTable);
  for (const t of pinned) db.exec(`INSERT INTO keep_eval SELECT evaluation_id FROM ${t} WHERE evaluation_id IN (SELECT id FROM evaluations WHERE conversation_id IN (SELECT id FROM keep_conv))`);

  run('DELETE FROM evaluations WHERE id NOT IN (SELECT id FROM keep_eval)');
  run('DELETE FROM conversations WHERE id NOT IN (SELECT id FROM keep_conv)');
  for (const t of ['operator_assignments', 'reviews', 'comments', 'tasks', 'crosschecks', 'tags', 'notifications'])
    run(`DELETE FROM ${t} WHERE conversation_id IS NOT NULL AND conversation_id NOT IN (SELECT id FROM keep_conv)`);
  run('DELETE FROM appeals WHERE evaluation_id NOT IN (SELECT id FROM evaluations)');
  run("DELETE FROM events WHERE type NOT LIKE 'directory.%' AND (conversation_id IS NULL OR conversation_id NOT IN (SELECT id FROM keep_conv))");
  run('DELETE FROM jobs');
})();
db.pragma('journal_mode = DELETE');
db.exec('VACUUM');

const count = (t) => (hasTable(t) ? db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n : 0);
const summary = Object.fromEntries(['conversations', 'evaluations', 'checklist_versions', 'people', 'teams', 'events', 'reviews', 'appeals'].map((t) => [t, count(t)]));
const foreign = db.prepare('SELECT COUNT(*) n FROM conversations WHERE dataset_group_id <> ?').get(group).n;
db.close();
if (foreign) {
  rmSync(tmp, { force: true });
  throw new Error(`export aborted: ${foreign} conversation(s) outside group ${group}`);
}
rmSync(target, { force: true });
rmSync(`${target}-wal`, { force: true });
rmSync(`${target}-shm`, { force: true });
renameSync(tmp, target);
console.log(`wrote ${target} (${(statSync(target).size / 1e6).toFixed(1)} MB) for group ${group}:`, summary);
