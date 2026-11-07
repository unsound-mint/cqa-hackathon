// One command for the control round: import the organizers' group, evaluate every conversation,
// write and validate results/prod/results.json. Needs the app running (`pnpm start`).
//   pnpm prod <groupId> [--expect 10]
// Safe to re-run: import is idempotent, already evaluated conversations are reused, only failures retry.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const group = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--expect');
const expect = args.includes('--expect') ? Number(args[args.indexOf('--expect') + 1]) : 10;
if (!group) { console.error('usage: pnpm prod <groupId> [--expect 10]'); process.exit(2); }
try { process.loadEnvFile(join(root, '.env')); } catch { /* optional */ }
const base = process.env.CQA_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8787}`;

const die = (m) => { console.error(`\n✗ ${m}`); process.exit(1); };
async function api(path, init) {
  let res;
  try { res = await fetch(base + path, { ...init, headers: { 'content-type': 'application/json' } }); }
  catch { die(`cannot reach ${base}. Start the app first: pnpm start`); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) die(`${path} -> ${res.status} ${body.error ?? ''}`);
  return body;
}

console.log(`1/4 importing group ${group}`);
const imp = await api('/api/datasets/import', { method: 'POST', body: JSON.stringify({ groupId: group }) });
console.log(`    imported ${imp.imported}/${imp.total}`);
if (imp.failed.length) die(`records rejected: ${JSON.stringify(imp.failed)}`);
if (imp.imported !== expect) die(`expected ${expect} conversations, got ${imp.imported}. Wrong group id? (--expect N to override)`);

const checklists = await api('/api/checklists');
const original = checklists.find((c) => c.version === 1); // the eight organizer criteria the submission format fixes
if (!original) die('original checklist (version 1) not found');

const Database = createRequire(join(root, 'apps/api/package.json'))('better-sqlite3');
const dbPath = process.env.DATABASE_PATH ? resolve(join(root, 'apps/api'), process.env.DATABASE_PATH) : join(root, 'data/cqa.sqlite');
const db = new Database(dbPath, { readonly: true });
const ids = db.prepare('select id from conversations where dataset_group_id = ? order by id').all(group).map((r) => r.id);
db.close();

console.log(`2/4 evaluating ${ids.length} conversations`);
const { jobId } = await api('/api/evaluations', { method: 'POST', body: JSON.stringify({ conversationIds: ids, checklistVersionId: original.id }) });
for (;;) {
  const j = await api(`/api/jobs/${jobId}`);
  process.stdout.write(`\r    ${j.completed}/${j.total} (${j.status})   `);
  if (j.status !== 'pending' && j.status !== 'running') break;
  await new Promise((r) => setTimeout(r, 3000));
}
console.log();

console.log('3/4 exporting results/prod/results.json');
const run = (a) => spawnSync(process.execPath, [join(root, 'scripts/export-results.mjs'), ...a], { stdio: 'inherit' }).status;
const status = run(['--group', group, '--out', join(root, 'results/prod/results.json'), '--expect', String(expect)]);
if (status) die('export/validation failed (see above). Re-run `pnpm prod` to retry failed evaluations');
console.log('4/4 done. Now: git add results/prod && git commit -m "Control results" && git push');
