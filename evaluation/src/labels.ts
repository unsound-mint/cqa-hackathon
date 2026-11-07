import type { ChecklistVersion, Criterion, CriterionValue } from '@cqa/contracts';
import { parseCsv } from './csv.js';

/** Header of evaluation/annotation-template.csv (docs/VALIDATION.md "Annotation fields"). */
export const LABEL_COLUMNS = ['conversation_id', 'language', 'channel', 'criterion_id', 'human_value', 'human_na', 'human_critical', 'evidence_message_indices', 'inspected_range', 'rationale', 'uncertainty', 'reviewer', 'adjudicated'] as const;

export type HumanLabel = {
  conversationId: string;
  criterionId: string;
  value: CriterionValue | null;
  isNA: boolean;
  evidence: number[];
  inspectedRange?: { from: number; to: number };
  rationale: string;
  uncertainty: string;
  reviewer: string;
  adjudicated: boolean;
};

export type LabelProblem = { row: number; conversationId?: string; criterionId?: string; message: string };

const YES = new Set(['true', 'yes', 'y', '1', 'да', 'д', 'иә', '+', 'истина']);
const NO = new Set(['false', 'no', 'n', '0', 'нет', 'н', 'жоқ', '-', 'ложь']);
const NA = new Set(['na', 'n/a', 'н/д', 'н/п']);
const norm = (s: string) => s.trim().toLowerCase();

/** Cell -> value for a criterion, or an error text. Never guesses: anything unrecognised is a problem. */
export function parseValue(raw: string, c: Criterion): { value: CriterionValue } | { error: string } {
  const t = norm(raw);
  if (c.kind === 'boolean') {
    if (YES.has(t)) return { value: true };
    if (NO.has(t)) return { value: false };
    return { error: `"${raw}" is not yes/no` };
  }
  if (c.kind === 'discrete-scale') {
    const n = Number(t.replace(',', '.'));
    if (t !== '' && Number.isFinite(n) && c.allowedValues.includes(n)) return { value: n };
    return { error: `"${raw}" is not one of ${JSON.stringify(c.allowedValues)}` };
  }
  const hit = c.allowedValues.find((v) => norm(String(v)) === t);
  return hit !== undefined ? { value: hit } : { error: `"${raw}" is not one of ${JSON.stringify(c.allowedValues)}` };
}

const indices = (raw: string): number[] | null => {
  const parts = raw.split(/[;,\s]+/).filter(Boolean);
  const nums = parts.map(Number);
  return nums.every((n) => Number.isInteger(n) && n >= 0) ? nums : null;
};

export type ParsedLabels = { labels: HumanLabel[]; blanks: { conversationId: string; criterionId: string }[]; problems: LabelProblem[] };

/**
 * Reads the human annotation CSV. A row with neither value nor N/A is a BLANK (reported as incomplete, never
 * filled in). Invalid cells are reported as problems and the row is excluded.
 */
export function parseLabels(csvText: string, checklist: ChecklistVersion): ParsedLabels {
  const table = parseCsv(csvText);
  const head = (table[0] ?? []).map((h) => norm(h));
  const col = (name: string) => head.indexOf(name);
  const labels: HumanLabel[] = [];
  const blanks: ParsedLabels['blanks'] = [];
  const problems: LabelProblem[] = [];
  for (const need of ['conversation_id', 'criterion_id']) if (col(need) < 0) return { labels, blanks, problems: [{ row: 1, message: `missing required column ${need}` }] };
  const get = (r: string[], name: string) => (col(name) >= 0 ? (r[col(name)] ?? '').trim() : '');
  const seen = new Set<string>();

  table.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const conversationId = get(r, 'conversation_id');
    const criterionId = get(r, 'criterion_id');
    const ctx = { row: rowNo, conversationId, criterionId };
    const criterion = checklist.criteria.find((c) => c.id === criterionId);
    if (!conversationId || !criterion) return void problems.push({ ...ctx, message: criterion ? 'missing conversation_id' : `unknown criterion_id (checklist ${checklist.id})` });
    const key = `${conversationId}\u0000${criterionId}`;
    if (seen.has(key)) return void problems.push({ ...ctx, message: 'duplicate row for this conversation and criterion' });
    seen.add(key);

    const naCell = norm(get(r, 'human_na'));
    let valueCell = get(r, 'human_value');
    if (valueCell === '' && criterion.criticalFlag) valueCell = get(r, 'human_critical');
    const isNA = YES.has(naCell) || NA.has(naCell) || NA.has(norm(valueCell));
    if (!isNA && valueCell === '' && naCell === '') return void blanks.push({ conversationId, criterionId });
    if (naCell !== '' && !isNA && !NO.has(naCell)) return void problems.push({ ...ctx, message: `human_na "${get(r, 'human_na')}" is not yes/no` });

    let value: CriterionValue | null = null;
    if (isNA) {
      if (!criterion.allowNA) return void problems.push({ ...ctx, message: 'N/A is not permitted for this criterion' });
      if (valueCell !== '' && !NA.has(norm(valueCell))) return void problems.push({ ...ctx, message: 'both a value and N/A were given' });
    } else {
      const p = parseValue(valueCell, criterion);
      if ('error' in p) return void problems.push({ ...ctx, message: p.error });
      value = p.value;
    }

    const evRaw = get(r, 'evidence_message_indices');
    const evidence = evRaw === '' ? [] : indices(evRaw);
    if (evidence === null) return void problems.push({ ...ctx, message: `evidence indices "${evRaw}" must be zero-based integers` });
    const rangeRaw = get(r, 'inspected_range');
    let inspectedRange: HumanLabel['inspectedRange'];
    if (rangeRaw !== '') {
      const m = /^(\d+)\s*[-–:]\s*(\d+)$/.exec(rangeRaw);
      if (!m || Number(m[1]) > Number(m[2])) return void problems.push({ ...ctx, message: `inspected_range "${rangeRaw}" must look like 3-11` });
      inspectedRange = { from: Number(m[1]), to: Number(m[2]) };
    }
    labels.push({ conversationId, criterionId, value, isNA, evidence, inspectedRange, rationale: get(r, 'rationale'), uncertainty: get(r, 'uncertainty'), reviewer: get(r, 'reviewer'), adjudicated: YES.has(norm(get(r, 'adjudicated'))) });
  });
  return { labels, blanks, problems };
}

/**
 * Rows for a blank annotation sheet: one per conversation x criterion, ids/language/channel pre-filled and every
 * judgment column empty. With `existing` rows, only the missing pairs are appended (labels are never touched).
 */
export function buildSheet(existing: string[][], ids: string[], conversations: { id: string; language: string; channel: string }[], checklist: ChecklistVersion): string[][] {
  const rows = existing.length ? existing.map((r) => [...r]) : [[...LABEL_COLUMNS]];
  const have = new Set(rows.slice(1).map((r) => `${r[0]}\u0000${r[3]}`));
  for (const id of ids) {
    const c = conversations.find((x) => x.id === id);
    if (!c) throw new Error(`unknown conversation id ${id}`);
    for (const crit of checklist.criteria) if (!have.has(`${id}\u0000${crit.id}`)) rows.push([id, c.language, c.channel, crit.id, ...LABEL_COLUMNS.slice(4).map(() => '')]);
  }
  return rows;
}
