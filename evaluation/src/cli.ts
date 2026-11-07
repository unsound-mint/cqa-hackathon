#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ChecklistVersionSchema, ConversationSchema, EvaluationSchema, type ChecklistVersion } from '@cqa/contracts';
import { z } from 'zod';
import { compare } from './compare.js';
import { parseCsv, toCsv } from './csv.js';
import { buildSheet, parseLabels } from './labels.js';
import { formatReport } from './report.js';

const USAGE = `Usage (run from the repo root: pnpm --filter @cqa/evaluation cli <command> ...)
  list    [--api URL]                                   conversations to choose from (no scores shown)
  sheet   --ids a,b,c [--checklist ID] [--out FILE] [--append]   blank label sheet, one row per criterion
  compare [--labels FILE] [--checklist ID] [--final] [--high-weight N] [--text] [--out FILE] [--json] [--api URL]
Defaults: --api http://127.0.0.1:8787, --labels/--out evaluation/private/*  (git-ignored)`;

/** Default: evaluation/private/annotations.csv (git-ignored), wherever the command is run from. */
const DEFAULT_LABELS = fileURLToPath(new URL('../private/annotations.csv', import.meta.url));
/** pnpm runs scripts inside the package folder; user-given relative paths mean the folder they typed the command in. */
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p);

async function get<T>(api: string, path: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(new URL(path, api));
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return schema.parse(await res.json());
}

function write(path: string, text: string) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, text);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { values: v } = parseArgs({
    args: rest,
    options: { api: { type: 'string' }, ids: { type: 'string' }, checklist: { type: 'string' }, out: { type: 'string' }, labels: { type: 'string' }, append: { type: 'boolean' }, final: { type: 'boolean' }, text: { type: 'boolean' }, json: { type: 'boolean' }, 'high-weight': { type: 'string' } },
  });
  const api = v.api ?? 'http://127.0.0.1:8787';

  if (command === 'list') {
    const convs = await get(api, '/api/conversations', z.array(ConversationSchema));
    console.log(['id', 'language', 'channel', 'messages', 'operator', 'client'].join('\t'));
    for (const c of convs) console.log([c.id, c.language, c.channel, c.transcript.length, c.transcript.filter((m) => m.speaker === 'operator').length, c.transcript.filter((m) => m.speaker === 'client').length].join('\t'));
    return;
  }

  const checklists = await get(api, '/api/checklists', z.array(ChecklistVersionSchema));
  const pick = (id?: string, fallback?: ChecklistVersion) => {
    const c = id ? checklists.find((x) => x.id === id) : fallback;
    if (!c) throw new Error(`checklist ${id ?? '(none)'} not found; available: ${checklists.map((x) => x.id).join(', ')}`);
    return c;
  };

  if (command === 'sheet') {
    if (!v.ids) throw new Error('--ids is required');
    const checklist = pick(v.checklist, checklists[0]);
    const convs = await get(api, '/api/conversations', z.array(ConversationSchema));
    const want = v.ids.split(',').map((s) => s.trim()).filter(Boolean);
    const out = v.out ? here(v.out) : DEFAULT_LABELS;
    let existing: string[][] = [];
    if (existsSync(out)) {
      if (!v.append) throw new Error(`${out} already exists; refusing to overwrite labels. Use --append to add missing rows.`);
      existing = parseCsv(readFileSync(out, 'utf8'));
    }
    const rows = buildSheet(existing, want, convs, checklist);
    write(out, toCsv(rows));
    console.log(`${out}: ${rows.length - 1} rows (${checklist.id}). Fill human_value (or human_na=yes). Nothing is pre-filled.`);
    return;
  }

  if (command === 'compare') {
    const evaluations = await get(api, '/api/evaluations', z.array(EvaluationSchema));
    const counts = new Map<string, number>();
    for (const e of evaluations) counts.set(e.checklistVersionId, (counts.get(e.checklistVersionId) ?? 0) + 1);
    const mostEvaluated = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    const checklist = pick(v.checklist ?? mostEvaluated, checklists[0]);
    const labelsPath = v.labels ? here(v.labels) : DEFAULT_LABELS;
    if (!existsSync(labelsPath)) throw new Error(`labels file ${labelsPath} not found (create one with the sheet command)`);
    const parsed = parseLabels(readFileSync(labelsPath, 'utf8'), checklist);
    for (const p of parsed.problems) console.error(`label problem row ${p.row}${p.conversationId ? ` (${p.conversationId}/${p.criterionId})` : ''}: ${p.message}`);
    const conversations = await get(api, '/api/conversations', z.array(ConversationSchema));
    const report = compare({ checklist, labels: parsed.labels, blanks: parsed.blanks, conversations, evaluations, useFinal: v.final, highWeight: v['high-weight'] ? Number(v['high-weight']) : undefined });
    const text = v.json ? JSON.stringify(report, null, 2) : formatReport(report, { includeText: v.text });
    if (v.out) { write(here(v.out), text); console.log(`report written to ${here(v.out)}`); } else console.log(text);
    if (parsed.problems.length) process.exitCode = 2;
    return;
  }

  console.log(USAGE);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
