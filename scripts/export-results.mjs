// Exports stored AI evaluations in the organizers' submission format (docs/official appendix, JSON 1.0).
//   node scripts/export-results.mjs --group DEV  --out results/dev/results.json  --team "<name>"
//   node scripts/export-results.mjs --group <prod group id> --out results/prod/results.json --expect 10
//   node scripts/export-results.mjs --check results/dev/results.json [--expect 65]
// Exports the immutable initial AI result (originalResults), never reviewer overrides.
// The submission format fixes eight criterion codes; our original checklist ids "01".."08" map onto them.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CODES = { '01': 'contact', '02': 'discovery', '03': 'identification', '04': 'consultation', '05': 'empathy', '06': 'dialogue', '07': 'closure', '08': 'critical' };
const SPEC = {
  contact: { weight: 10, values: [true, false] },
  discovery: { weight: 15, values: [true, false, null] },
  identification: { weight: 20, values: [true, false, null] },
  consultation: { weight: 20, values: [0, 5, 10, 15, 20, null], max: 20 },
  empathy: { weight: 15, values: [true, false] },
  dialogue: { weight: 15, values: [0, 4, 7, 10], max: 10 },
  closure: { weight: 5, values: [true, false, null] },
  critical: { weight: 0, values: [true, false] },
};

const args = process.argv.slice(2);
const opt = (n) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);

function expectedScore(criteria) {
  let earned = 0, weight = 0;
  for (const c of criteria) {
    const s = SPEC[c.criterion_id];
    if (!s.weight || c.value === null) continue;
    earned += s.weight * (s.max ? c.value / s.max : c.value ? 1 : 0);
    weight += s.weight;
  }
  return weight ? Math.round((100 * earned) / weight * 100) / 100 : null;
}

/** Returns a list of problems; empty means the file satisfies the format rules. */
export function check(file, expect) {
  const bad = [];
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return [`not valid JSON: ${e.message}`]; }
  if (doc.schema_version !== '1.0') bad.push('schema_version must be "1.0"');
  if (!doc.team_name) bad.push('team_name missing');
  if (!['local', 'external_api', 'hybrid'].includes(doc.model?.mode) || !doc.model?.name) bad.push('model.mode/name invalid');
  if (!Array.isArray(doc.results)) return [...bad, 'results is not an array'];
  if (expect !== undefined && doc.results.length !== expect) bad.push(`expected ${expect} results, found ${doc.results.length}`);
  const seen = new Set();
  for (const r of doc.results) {
    const id = r.conversation_id;
    if (!id || seen.has(id)) bad.push(`missing or duplicate conversation_id ${id}`);
    seen.add(id);
    if (r.status === 'error') {
      if (r.criteria?.length !== 0 || r.score !== null || !r.error) bad.push(`${id}: error record needs empty criteria, score null, error text`);
      continue;
    }
    if (r.status !== 'ok') { bad.push(`${id}: status must be ok or error`); continue; }
    const got = (r.criteria ?? []).map((c) => c.criterion_id).sort().join();
    if (got !== Object.keys(SPEC).sort().join()) bad.push(`${id}: need all 8 criteria exactly once (got ${got})`);
    for (const c of r.criteria ?? []) {
      const s = SPEC[c.criterion_id];
      if (!s || !s.values.includes(c.value)) bad.push(`${id}/${c.criterion_id}: value ${JSON.stringify(c.value)} not allowed`);
      if (typeof c.rationale !== 'string' || !c.rationale) bad.push(`${id}/${c.criterion_id}: rationale missing`);
      if (!Array.isArray(c.evidence_turns) || !c.evidence_turns.every((n) => Number.isInteger(n) && n >= 1)) bad.push(`${id}/${c.criterion_id}: evidence_turns must be 1-based integers`);
    }
    const crit = r.criteria?.find((c) => c.criterion_id === 'critical');
    if (typeof r.score?.final_score !== 'number' || r.score.final_score < 0 || r.score.final_score > 100) bad.push(`${id}: final_score out of range`);
    else if (r.criteria?.length === 8 && Math.abs(expectedScore(r.criteria) - r.score.final_score) > 0.011) bad.push(`${id}: final_score ${r.score.final_score} != recomputed ${expectedScore(r.criteria)}`);
    if (r.score?.critical_flag !== crit?.value) bad.push(`${id}: critical_flag must equal the critical value`);
  }
  return bad;
}

function exportGroup(group, out, team, expect) {
  const require = createRequire(join(root, 'apps/api/package.json'));
  const Database = require('better-sqlite3');
  try { process.loadEnvFile(join(root, '.env')); } catch { /* optional */ }
  // DATABASE_PATH is relative to apps/api (see .env.example), like the server resolves it.
  const db = new Database(process.env.DATABASE_PATH ? resolve(join(root, 'apps/api'), process.env.DATABASE_PATH) : join(root, 'data/cqa.sqlite'), { readonly: true });
  const convs = db.prepare('select id, transcript from conversations where dataset_group_id = ? order by rowid').all(group);
  const evals = db.prepare(`select e.* from evaluations e join checklist_versions v on v.id = e.checklist_version_id
    where e.conversation_id = ? and v.version = 1 order by e.created_at desc, e.rowid desc`);
  const models = new Set();
  const results = convs.map(({ id, transcript }) => {
    const rows = evals.all(id);
    const ok = rows.find((r) => r.status === 'completed');
    if (!ok) return { conversation_id: id, status: 'error', criteria: [], score: null, error: rows[0]?.error ?? 'not evaluated' };
    const prov = ok.provenance ? JSON.parse(ok.provenance) : {};
    if (prov.model) models.add(prov.model);
    const turns = JSON.parse(transcript).length;
    const criteria = JSON.parse(ok.original_results).map((c) => ({
      criterion_id: CODES[c.criterionId],
      value: c.isNA ? null : c.value,
      rationale: c.explanation,
      evidence_turns: [...new Set(c.evidence.map((e) => e.messageIndex + 1))].filter((n) => n <= turns).sort((a, b) => a - b),
    }));
    return { conversation_id: id, status: 'ok', criteria, score: { final_score: ok.original_total, critical_flag: Boolean(ok.serious_violation) } };
  });
  const doc = { schema_version: '1.0', team_name: team, model: { mode: 'external_api', name: [...models].join(', ') || 'unknown' }, results };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  console.log(`wrote ${out}: ${results.length} records (${results.filter((r) => r.status === 'error').length} error)`);
}

if (opt('check')) {
  const problems = check(opt('check'), opt('expect') ? Number(opt('expect')) : undefined);
  console.log(problems.length ? problems.join('\n') : 'OK: format valid');
  process.exit(problems.length ? 1 : 0);
}
const group = opt('group'), out = opt('out');
if (!group || !out) { console.error('usage: --group <id> --out <file> [--team <name>] [--expect <n>] | --check <file>'); process.exit(2); }
exportGroup(group, out, opt('team') ?? 'abSuRd', opt('expect'));
const problems = check(out, opt('expect') ? Number(opt('expect')) : undefined);
console.log(problems.length ? problems.join('\n') : 'OK: format valid');
process.exit(problems.length ? 1 : 0);
