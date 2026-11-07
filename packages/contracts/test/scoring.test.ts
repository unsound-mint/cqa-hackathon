import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DemoBundleSchema, ScoringError, computeTotal, deriveSeriousViolation, roundTo2, type CriterionResult } from '../src/index.js';

const checklist = DemoBundleSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/demo.json', import.meta.url), 'utf8'))).checklists[0]!;
const ids = checklist.criteria.map((c) => c.id);
const ok = (criterionId: string, value: CriterionResult['value']): CriterionResult => ({ criterionId, value, isNA: false, explanation: '', evidence: [] });
const na = (criterionId: string): CriterionResult => ({ criterionId, value: null, isNA: true, explanation: '', evidence: [] });

/** Full rubric answer set; overrides replace a criterion's result. */
const answers = (over: Record<string, CriterionResult> = {}) =>
  [ok('01', true), ok('02', true), ok('03', true), ok('04', 20), ok('05', true), ok('06', 10), ok('07', true), ok('08', false)].map((r) => over[r.criterionId] ?? r);

describe('original rubric (stored checklist)', () => {
  it('perfect answers give 100; all-no/zero give 0', () => {
    expect(computeTotal(checklist.criteria, answers())).toBe(100);
    const zero = answers({ '01': ok('01', false), '02': ok('02', false), '03': ok('03', false), '04': ok('04', 0), '05': ok('05', false), '06': ok('06', 0), '07': ok('07', false) });
    expect(computeTotal(checklist.criteria, zero)).toBe(0);
  });

  it.each([[20, 100], [15, 95], [10, 90], [5, 85], [0, 80]])('criterion 04 tier %i -> %f', (tier, total) => {
    expect(computeTotal(checklist.criteria, answers({ '04': ok('04', tier) }))).toBe(total);
  });

  it.each([[10, 100], [7, 95.5], [4, 91], [0, 85]])('criterion 06 tier %i -> %f', (tier, total) => {
    expect(computeTotal(checklist.criteria, answers({ '06': ok('06', tier) }))).toBe(total);
  });

  it.each([['02'], ['03'], ['04'], ['07']])('N/A on %s redistributes weight and keeps 100 reachable', (id) => {
    expect(computeTotal(checklist.criteria, answers({ [id]: na(id) }))).toBe(100);
  });

  it('N/A on every allowed criterion leaves 01, 05, 06 weights only (40 of 100 -> 100% when all pass)', () => {
    const all = answers({ '02': na('02'), '03': na('03'), '04': na('04'), '07': na('07') });
    expect(computeTotal(checklist.criteria, all)).toBe(100);
    expect(computeTotal(checklist.criteria, answers({ ...Object.fromEntries(['02', '03', '04', '07'].map((i) => [i, na(i)])), '01': ok('01', false) }))).toBe(75);
  });

  it('N/A is rejected where the rubric forbids it', () => {
    for (const id of ['01', '05', '06', '08']) expect(() => computeTotal(checklist.criteria, answers({ [id]: na(id) }))).toThrow(ScoringError);
  });

  it('criterion 08 is a flag: it never changes the total', () => {
    const yes = answers({ '08': ok('08', true) });
    expect(computeTotal(checklist.criteria, yes)).toBe(computeTotal(checklist.criteria, answers()));
    expect(deriveSeriousViolation(checklist.criteria, yes)).toBe(true);
    expect(deriveSeriousViolation(checklist.criteria, answers())).toBe(false);
  });

  it('every combination of allowed N/A stays within 0..100', () => {
    const optional = ['02', '03', '04', '07'];
    for (let mask = 0; mask < 16; mask++) {
      const over = Object.fromEntries(optional.filter((_, i) => mask & (1 << i)).map((i) => [i, na(i)]));
      const t = computeTotal(checklist.criteria, answers(over))!;
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(100);
    }
  });

  it('knows every criterion by config: result order does not matter', () => {
    expect(computeTotal(checklist.criteria, answers({ '04': ok('04', 5) }).reverse())).toBe(85);
    expect(ids).toHaveLength(8);
  });
});

describe('roundTo2', () => {
  it.each([[28.499999999999996 / 100 * 100, 28.5], [0.285, 0.29], [1.005, 1.01], [94.11764705882354, 94.12], [66.665, 66.67], [-0.285, -0.29], [0, 0], [100, 100]])('%f -> %f', (x, y) => {
    expect(roundTo2(x)).toBe(y);
  });
});
