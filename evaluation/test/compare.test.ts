import type { CriterionResult, Evaluation } from '@cqa/contracts';
import { describe, expect, it } from 'vitest';
import { compare } from '../src/compare.js';
import type { HumanLabel } from '../src/labels.js';
import { formatReport } from '../src/report.js';
import { checklist, conversation, evaluation } from './fixture.js';

const C = conversation.id;
/** Test device: "human" labels that start identical to the fixture's evaluation, then are edited per test. */
const asLabels = (results: CriterionResult[], id = C): HumanLabel[] => results.map((r) => ({ conversationId: id, criterionId: r.criterionId, value: r.value, isNA: r.isNA, evidence: [], rationale: '', uncertainty: '', reviewer: 't', adjudicated: false }));
const withLabel = (ls: HumanLabel[], criterionId: string, patch: Partial<HumanLabel>) => ls.map((l) => (l.criterionId === criterionId ? { ...l, ...patch } : l));
const run = (labels: HumanLabel[], extra: Partial<Parameters<typeof compare>[0]> = {}) => compare({ checklist, labels, blanks: [], conversations: [conversation], evaluations: [evaluation], ...extra });
const stamp = (e: Evaluation, source: Record<string, 'rule' | 'hybrid' | 'model'>): Evaluation => ({ ...e, originalResults: e.originalResults.map((r) => ({ ...r, source: source[r.criterionId] ?? 'model' })) });

describe('compare', () => {
  const same = asLabels(evaluation.originalResults);

  it('perfect agreement: 100% per criterion, MAE 0, no disagreements', () => {
    const r = run(same);
    expect(r.criteria.every((c) => c.agreement === 1)).toBe(true);
    expect(r.totals).toMatchObject({ n: 1, mae: 0, bias: 0 });
    expect(r.disagreements).toEqual([]);
    expect(r.coverage).toMatchObject({ labeledConversations: 1, fullyLabeled: 1 });
  });

  it('a disagreement moves the total by exactly the single-criterion impact, computed with the shared scorer', () => {
    const r = run(withLabel(same, '04', { value: 20 })); // model said 15
    expect(r.criteria.find((c) => c.id === '04')).toMatchObject({ n: 1, agreement: 0, meanAbsTierError: 5 });
    expect(r.totals.perConversation[0]).toMatchObject({ human: 100, model: 94.12 });
    expect(r.totals.mae).toBe(5.88);
    expect(r.totals.bias).toBe(-5.88);
    expect(r.disagreements[0]).toMatchObject({ criterionId: '04', human: '20', model: '15', impact: 5.88, weight: 20 });
    expect(r.impactByCriterion).toEqual([{ criterionId: '04', totalImpact: 5.88, disagreements: 1 }]);
    expect(r.highWeightFailures).toBe(1);
  });

  it('reports model, effort, tokens, latency and cost from provenance; rule-only evaluations are excluded from the means', () => {
    const timed: Evaluation = { ...evaluation, provenance: { provider: 'anthropic', model: 'claude-haiku-5-5', promptVersion: 'eval-v6', effort: 'medium', usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 10000 }, latencyMs: 4000 } };
    const r = run(same, { evaluations: [timed], pricePerMTok: { input: 0.1, output: 0.5 } });
    expect(r.run).toMatchObject({ evaluations: 1, models: ['claude-haiku-5-5'], efforts: ['medium'], promptVersions: ['eval-v6'], withUsage: 1, meanInputTokens: 11000, meanOutputTokens: 500, meanLatencyMs: 4000 });
    expect(r.run.meanCostUsd).toBe(0.00045); // (1000 + 10000*0.1) * 0.1/1e6 + 500 * 0.5/1e6
    expect(formatReport(r)).toMatch(/claude-haiku-5-5; effort: medium; prompt: eval-v6/);
    const ruleOnly = run(same, { evaluations: [{ ...evaluation, provenance: { provider: 'local', model: 'rules+reuse', promptVersion: 'n/a' } }] });
    expect(ruleOnly.run).toMatchObject({ withUsage: 0, meanInputTokens: null, meanCostUsd: null });
  });

  it('counts N/A confusion both ways and false N/A', () => {
    const humanSaysNA = run(withLabel(same, '05', { value: null, isNA: false }).map((l) => (l.criterionId === '02' ? { ...l, value: true, isNA: false } : l)));
    expect(humanSaysNA.criteria.find((c) => c.id === '02')!.na).toMatchObject({ modelOnly: 1 }); // model N/A, human answered
    expect(humanSaysNA.naErrors.falseNA).toBe(1);
    const missed = run(withLabel(same, '07', { value: null, isNA: true }));
    expect(missed.criteria.find((c) => c.id === '07')!.na).toMatchObject({ humanOnly: 1 });
    expect(missed.naErrors.missedNA).toBe(1);
  });

  it('incomplete conversations count per criterion but are excluded from totals; blanks are reported', () => {
    const labels = same.filter((l) => l.criterionId !== '06');
    const r = run(labels, { blanks: [{ conversationId: C, criterionId: '06' }] });
    expect(r.coverage.incomplete).toEqual([{ conversationId: C, missing: ['06'] }]);
    expect(r.coverage.fullyLabeled).toBe(0);
    expect(r.totals.n).toBe(0);
    expect(r.criteria.find((c) => c.id === '01')!.n).toBe(1);
    expect(r.criteria.find((c) => c.id === '06')!.n).toBe(0);
    expect(formatReport(r)).toContain('INCOMPLETE');
  });

  it('reports conversations without a usable prediction instead of guessing', () => {
    expect(run(same, { evaluations: [] }).coverage.noPrediction).toEqual([C]);
    const failed: Evaluation = { ...evaluation, status: 'failed', originalResults: [], finalResults: [], originalTotal: null, finalTotal: null, error: 'x' };
    expect(run(same, { evaluations: [failed] }).coverage.failedEvaluation).toEqual([C]);
    expect(run(same, { conversations: [] }).coverage.unknownConversation).toEqual([C]);
  });

  it('serious-violation confusion matrix', () => {
    const tp = run(withLabel(same, '08', { value: true }), { evaluations: [{ ...evaluation, originalResults: evaluation.originalResults.map((r) => (r.criterionId === '08' ? { ...r, value: true } : r)) }] });
    expect(tp.seriousViolation).toMatchObject({ tp: 1, fp: 0, fn: 0, sensitivity: 1, precision: 1 });
    const fn = run(withLabel(same, '08', { value: true }));
    expect(fn.seriousViolation).toMatchObject({ tp: 0, fn: 1, sensitivity: 0, precision: null });
  });

  it('checks the model\'s evidence against the transcript', () => {
    expect(run(same).evidenceValidity.rate).toBe(1);
    const tampered: Evaluation = { ...evaluation, originalResults: evaluation.originalResults.map((r) => (r.criterionId === '01' ? { ...r, evidence: [{ messageIndex: 4, quote: 'fabricated' }] } : r)) };
    const r = run(same, { evaluations: [tampered] });
    expect(r.evidenceValidity.valid).toBe(r.evidenceValidity.checked - 1);
  });

  it('splits agreement by decision source, confidence, language and channel', () => {
    const e = stamp(evaluation, { '01': 'rule', '03': 'hybrid' });
    const r = run(withLabel(same, '01', { value: false }), { evaluations: [e] });
    expect(r.criteria.find((c) => c.id === '01')!.bySource).toEqual({ rule: { n: 1, agreement: 0 } });
    expect(r.criteria.find((c) => c.id === '03')!.bySource).toEqual({ hybrid: { n: 1, agreement: 1 } });
    expect(r.byLanguage.RU).toMatchObject({ n: 8 });
    expect(r.byChannel['agent chat']).toMatchObject({ n: 8 });
  });

  it('compares reviewer-corrected results when asked', () => {
    const fixed: Evaluation = { ...evaluation, finalResults: evaluation.finalResults.map((r) => (r.criterionId === '04' ? { ...r, value: 20 } : r)) };
    const labels = withLabel(same, '04', { value: 20 });
    expect(run(labels, { evaluations: [fixed] }).disagreements).toHaveLength(1);
    expect(run(labels, { evaluations: [fixed], useFinal: true }).disagreements).toHaveLength(0);
  });

  it('formats a report; free text is private and only included on request', () => {
    const labels = withLabel(same, '04', { value: 20, rationale: 'HUMAN REASON' });
    const r = run(labels);
    expect(formatReport(r)).not.toContain('HUMAN REASON');
    const text = formatReport(r, { includeText: true });
    expect(text).toContain('HUMAN REASON');
    expect(text).toMatch(/Where the score is lost/);
  });
});
