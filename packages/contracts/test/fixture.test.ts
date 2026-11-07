import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DemoBundleSchema, computeTotal, deriveSeriousViolation, findEvidenceProblems } from '../src/index.js';

const bundle = DemoBundleSchema.parse(JSON.parse(readFileSync(new URL('../../../fixtures/demo.json', import.meta.url), 'utf8')));
const conversation = bundle.conversations[0]!;
const checklist = bundle.checklists[0]!;
const evaluation = bundle.evaluations[0]!;

describe('fixtures/demo.json', () => {
  it('has all four speaker roles and stable zero-based indices', () => {
    expect(new Set(conversation.transcript.map((m) => m.speaker))).toEqual(new Set(['client', 'operator', 'bot', 'system']));
    conversation.transcript.forEach((m, i) => expect(m.index).toBe(i));
  });

  it('evidence and checkedRange are grounded in the transcript', () => {
    expect(findEvidenceProblems(conversation, evaluation.originalResults)).toEqual([]);
  });

  it('results use allowed values and N/A only where permitted', () => {
    for (const r of evaluation.originalResults) {
      const c = checklist.criteria.find((x) => x.id === r.criterionId)!;
      if (r.isNA) expect(c.allowNA).toBe(true);
      else expect(c.allowedValues).toContain(r.value);
    }
  });

  it('operator-action criteria never cite bot messages as evidence', () => {
    const bots = new Set(conversation.transcript.filter((m) => m.speaker === 'bot').map((m) => m.index));
    for (const r of evaluation.originalResults) for (const e of r.evidence) expect(bots.has(e.messageIndex)).toBe(false);
  });

  it('identity-verification system event precedes the first protected disclosure', () => {
    const verified = conversation.transcript.findIndex((m) => m.speaker === 'system' && m.text.includes('Личность клиента подтверждена'));
    const disclosure = conversation.transcript.findIndex((m) => m.speaker === 'operator' && m.text.includes('Вижу заказ'));
    expect(verified).toBeGreaterThan(-1);
    expect(disclosure).toBeGreaterThan(verified);
  });

  it('stored totals equal the single scoring function', () => {
    expect(computeTotal(checklist.criteria, evaluation.originalResults)).toBe(evaluation.originalTotal);
    expect(computeTotal(checklist.criteria, evaluation.finalResults)).toBe(evaluation.finalTotal);
    expect(deriveSeriousViolation(checklist.criteria, evaluation.originalResults)).toBe(evaluation.seriousViolation);
  });
});
