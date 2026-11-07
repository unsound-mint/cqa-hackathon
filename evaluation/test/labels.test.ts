import { describe, expect, it } from 'vitest';
import { LABEL_COLUMNS, buildSheet, parseLabels } from '../src/labels.js';
import { toCsv } from '../src/csv.js';
import { checklist, conversation } from './fixture.js';

const head = LABEL_COLUMNS.join(',');
const csv = (...lines: string[]) => [head, ...lines].join('\n');
const C = conversation.id;

describe('parseLabels', () => {
  it('reads yes/no in several languages, scale tiers, N/A and evidence', () => {
    const r = parseLabels(csv(`${C},RU,agent chat,01,Да,,,4,3-4,greeted,,eldana,no`, `${C},RU,agent chat,04,15,,,"8;9",,partial,low,eldana,yes`, `${C},RU,agent chat,02,,yes,,1,0-4,enough info,,eldana,`, `${C},RU,agent chat,05,no,,,,,,,,`), checklist);
    expect(r.problems).toEqual([]);
    expect(r.labels.map((l) => [l.criterionId, l.value, l.isNA])).toEqual([['01', true, false], ['04', 15, false], ['02', null, true], ['05', false, false]]);
    expect(r.labels[1]).toMatchObject({ evidence: [8, 9], uncertainty: 'low', adjudicated: true });
    expect(r.labels[0]!.inspectedRange).toEqual({ from: 3, to: 4 });
  });

  it('reports empty rows as blanks and never fills them', () => {
    const r = parseLabels(csv(`${C},RU,agent chat,01,,,,,,,,,`), checklist);
    expect(r.labels).toEqual([]);
    expect(r.blanks).toEqual([{ conversationId: C, criterionId: '01' }]);
  });

  it('flags invalid cells instead of guessing', () => {
    const r = parseLabels(csv(`${C},,,04,12,,,,,,,,`, `${C},,,01,maybe,,,,,,,,`, `${C},,,06,,yes,,,,,,,`, `${C},,,99,yes,,,,,,,,`, `${C},,,05,yes,,,x,,,,,`, `${C},,,03,yes,,,,7-3,,,,`, `${C},,,07,yes,yes,,,,,,,`), checklist);
    expect(r.labels).toEqual([]);
    expect(r.problems.map((p) => p.message)).toEqual([
      expect.stringContaining('not one of'),
      expect.stringContaining('not yes/no'),
      expect.stringContaining('N/A is not permitted'),
      expect.stringContaining('unknown criterion_id'),
      expect.stringContaining('zero-based integers'),
      expect.stringContaining('must look like'),
      expect.stringContaining('both a value and N/A'),
    ]);
  });

  it('rejects duplicate rows and reads the flag criterion from human_critical when human_value is empty', () => {
    const r = parseLabels(csv(`${C},,,08,,,yes,,,,,,`, `${C},,,08,no,,,,,,,,`), checklist);
    expect(r.labels).toHaveLength(1);
    expect(r.labels[0]).toMatchObject({ criterionId: '08', value: true });
    expect(r.problems[0]!.message).toContain('duplicate');
  });

  it('needs the key columns', () => {
    expect(parseLabels('a,b\n1,2\n', checklist).problems[0]!.message).toContain('missing required column');
  });
});

describe('buildSheet', () => {
  const convs = [{ id: C, language: 'RU', channel: 'agent chat' }];
  it('creates one blank row per criterion with nothing pre-judged', () => {
    const rows = buildSheet([], [C], convs, checklist);
    expect(rows[0]).toEqual([...LABEL_COLUMNS]);
    expect(rows).toHaveLength(1 + checklist.criteria.length);
    for (const r of rows.slice(1)) expect(r.slice(4).every((c) => c === '')).toBe(true);
  });
  it('append adds only missing pairs and keeps existing labels byte-for-byte', () => {
    const existing = [[...LABEL_COLUMNS], [C, 'RU', 'agent chat', '01', 'yes', '', '', '', '', 'my note', '', 'e', '']];
    const rows = buildSheet(existing, [C], convs, checklist);
    expect(rows[1]).toEqual(existing[1]);
    expect(rows).toHaveLength(1 + checklist.criteria.length);
    expect(toCsv(buildSheet(rows, [C], convs, checklist))).toBe(toCsv(rows)); // idempotent
  });
  it('rejects unknown ids', () => {
    expect(() => buildSheet([], ['nope'], convs, checklist)).toThrow(/unknown conversation id/);
  });
});
