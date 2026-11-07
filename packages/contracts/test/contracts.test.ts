import { describe, expect, it } from 'vitest';
import {
  criterionSignature,
  ConversationSchema,
  CriterionResultSchema,
  CriterionSchema,
  SaveChecklistInputSchema,
  ScoringError,
  computeTotal,
  type Criterion,
  type CriterionResult,
} from '../src/index.js';

const bool = (id: string, weight: number, extra: Partial<Criterion> = {}): Criterion => ({
  id, title: id, instructions: '', weight, kind: 'boolean', allowedValues: [true, false], allowNA: false, ...extra,
});
const scale = (id: string, weight: number, tiers: number[], extra: Partial<Criterion> = {}): Criterion => ({
  id, title: id, instructions: '', weight, kind: 'discrete-scale', allowedValues: tiers, allowNA: false, ...extra,
});
const ok = (criterionId: string, value: CriterionResult['value']): CriterionResult => ({ criterionId, value, isNA: false, explanation: '', evidence: [] });
const na = (criterionId: string): CriterionResult => ({ criterionId, value: null, isNA: true, explanation: '', evidence: [] });

describe('computeTotal', () => {
  it('normalizes booleans and scales by weight; top tier gives full weight', () => {
    const cs = [bool('a', 10), scale('b', 30, [0, 5, 10, 15, 20]), scale('c', 60, [0, 4, 7, 10])];
    expect(computeTotal(cs, [ok('a', true), ok('b', 20), ok('c', 10)])).toBe(100);
    expect(computeTotal(cs, [ok('a', false), ok('b', 10), ok('c', 7)])).toBe(57);
  });

  it('redistributes N/A weight proportionally and works for ids/scales the rubric never named', () => {
    const cs = [bool('x1', 10), bool('x2', 20, { allowNA: true }), scale('x3', 10, [0, 1, 2, 3, 4, 5])];
    expect(computeTotal(cs, [ok('x1', true), na('x2'), ok('x3', 5)])).toBe(100);
    expect(computeTotal(cs, [ok('x1', false), na('x2'), ok('x3', 5)])).toBe(50);
  });

  it('returns null when no weighted criterion applies', () => {
    const cs = [bool('a', 10, { allowNA: true }), bool('flag', 0, { criticalFlag: true })];
    expect(computeTotal(cs, [na('a'), ok('flag', false)])).toBeNull();
  });

  it('rounds to two decimals', () => {
    const cs = [bool('a', 1), bool('b', 1), bool('c', 1)];
    expect(computeTotal(cs, [ok('a', true), ok('b', false), ok('c', false)])).toBe(33.33);
    expect(computeTotal(cs, [ok('a', true), ok('b', true), ok('c', false)])).toBe(66.67);
  });

  it('fails closed on invalid states', () => {
    const cs = [bool('a', 10), scale('b', 10, [0, 5, 10])];
    expect(() => computeTotal(cs, [ok('a', true), ok('b', 7)])).toThrow(ScoringError); // value not allowed
    expect(() => computeTotal(cs, [na('a'), ok('b', 5)])).toThrow(ScoringError); // N/A not allowed
    expect(() => computeTotal(cs, [ok('a', true)])).toThrow(ScoringError); // missing result
    expect(() => computeTotal(cs, [ok('a', true), ok('b', 5), ok('zzz', true)])).toThrow(ScoringError); // unknown
    expect(() => computeTotal(cs, [ok('a', true), ok('a', true), ok('b', 5)])).toThrow(ScoringError); // duplicate
  });

  it('does not mutate its inputs', () => {
    const cs = [bool('a', 10)];
    const rs = [ok('a', true)];
    const snapshot = JSON.stringify([cs, rs]);
    computeTotal(cs, rs);
    expect(JSON.stringify([cs, rs])).toBe(snapshot);
  });
});

describe('schemas', () => {
  it('CriterionResult: exactly one of N/A or a value', () => {
    expect(CriterionResultSchema.safeParse({ ...ok('a', true), isNA: true }).success).toBe(false);
    expect(CriterionResultSchema.safeParse({ ...ok('a', null) }).success).toBe(false);
    expect(CriterionResultSchema.safeParse(na('a')).success).toBe(true);
  });

  it('Conversation: index must equal array position', () => {
    const base = { id: 'c', datasetGroupId: 'g', language: 'EN', channel: 'agent chat', audioUrl: null };
    const m = (index: number) => ({ index, timestamp: '00:00', speaker: 'client', text: 'hi' });
    expect(ConversationSchema.safeParse({ ...base, transcript: [m(0), m(1)] }).success).toBe(true);
    expect(ConversationSchema.safeParse({ ...base, transcript: [m(0), m(2)] }).success).toBe(false);
  });

  it('Criterion: kind-specific allowedValues, weight and flag rules', () => {
    expect(CriterionSchema.safeParse(bool('a', 5, { allowedValues: [true] })).success).toBe(false);
    expect(CriterionSchema.safeParse(scale('a', 5, [0])).success).toBe(false);
    expect(CriterionSchema.safeParse(scale('a', 5, [0, 1, 2])).success).toBe(true);
    expect(CriterionSchema.safeParse(bool('a', 5, { criticalFlag: true })).success).toBe(false);
  });

  it('SaveChecklistInput: rejects duplicate ids and unknown sections', () => {
    const c = bool('a', 10);
    expect(SaveChecklistInputSchema.safeParse({ title: 't', criteria: [c, c] }).success).toBe(false);
    expect(SaveChecklistInputSchema.safeParse({ title: 't', criteria: [{ ...c, sectionId: 's' }] }).success).toBe(false);
    expect(SaveChecklistInputSchema.safeParse({ title: 't', criteria: [c] }).success).toBe(true);
  });
});

describe('criterionSignature', () => {
  it('ignores weight/title/section, notices anything that changes the decision', () => {
    const a = bool('a', 10, { instructions: 'x' });
    expect(criterionSignature({ ...a, weight: 0, title: 'other', sectionId: 's' })).toBe(criterionSignature(a));
    for (const change of [{ instructions: 'y' }, { allowNA: true }, { naCondition: 'c' }, { criticalFlag: true }, { detector: 'd' }, { kind: 'discrete-scale' as const, allowedValues: [0, 1] }]) {
      expect(criterionSignature({ ...a, ...change })).not.toBe(criterionSignature(a));
    }
  });
});
