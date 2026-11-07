import type { Appeal, ChecklistVersion, Conversation, CriterionResult, Evaluation } from '@cqa/contracts';
import { expect, it } from 'vitest';
import { computeStats } from '../src/lib/stats';

const msg = [{ index: 0, timestamp: '00:00', speaker: 'client' as const, text: 'x' }];
const conv = (id: string, language: 'RU' | 'KZ' | 'EN'): Conversation => ({ id, datasetGroupId: 'g', language, channel: 'agent chat', transcript: msg, audioUrl: null });

// Arbitrary criteria (none of the original eight ids): a scale, a yes/no with N/A, and a serious-violation flag.
const checklist = (id: string, version: number): ChecklistVersion => ({
  id, version, title: 'Custom', createdAt: '2026-11-08T00:00:00Z',
  criteria: [
    { id: 'x1', title: 'Scale', instructions: '', weight: 10, kind: 'discrete-scale', allowedValues: [0, 5, 10], allowNA: false },
    { id: 'x2', title: 'Yes/no', instructions: '', weight: 10, kind: 'boolean', allowedValues: [true, false], allowNA: true },
    { id: 'x3', title: 'Flag', instructions: '', weight: 0, kind: 'boolean', allowedValues: [true, false], allowNA: false, criticalFlag: true },
  ],
});
const r = (criterionId: string, value: CriterionResult['value'], extra: Partial<CriterionResult> = {}): CriterionResult => ({ criterionId, value, isNA: value === null, explanation: '', evidence: [], ...extra });
const ev = (id: string, conversationId: string, checklistVersionId: string, results: CriterionResult[], total: number | null, extra: Partial<Evaluation> = {}): Evaluation => ({
  id, conversationId, checklistVersionId, status: 'completed', originalResults: results, originalTotal: total, finalResults: results, finalTotal: total,
  seriousViolation: results.some((x) => x.criterionId === 'x3' && x.value === true), ...extra,
});
const appeal = (id: string, evaluationId: string, status: Appeal['status'], kind: Appeal['kind'] = 'appeal'): Appeal => ({ id, evaluationId, criterionId: 'x1', kind, comment: '', status, createdAt: '2026-11-08T00:00:00Z' });

const base = { checklists: [checklist('c1', 1), checklist('c2', 2)], checklistId: null, language: 'all' as const };

it('counts only the current evaluation of each dialog and splits criterion outcomes by points earned', () => {
  const conversations = [conv('a', 'RU'), conv('b', 'KZ'), conv('c', 'EN'), conv('d', 'EN')];
  const evaluations = [
    ev('e0', 'a', 'c1', [r('x1', 0), r('x2', false), r('x3', false)], 0), // superseded by e1
    ev('e1', 'a', 'c1', [r('x1', 10), r('x2', true), r('x3', false)], 20),
    ev('e2', 'b', 'c1', [r('x1', 5), r('x2', null), r('x3', true)], 5),
    ev('e3', 'c', 'c1', [], null, { status: 'failed', finalResults: [], originalResults: [] }),
  ];
  const s = computeStats({ ...base, conversations, evaluations, appeals: [] });
  expect(s).toMatchObject({ dialogs: 4, evaluated: 2, failed: 1, notEvaluated: 1, seriousViolations: 1, averageTotal: 12.5 });
  const [x1, x2, x3] = s.criteria;
  expect(x1).toMatchObject({ total: 2, full: 1, partial: 1, zero: 0, earnedShare: 15 / 20 });
  expect(x2).toMatchObject({ total: 2, full: 1, na: 1, earnedShare: 1 });
  expect(x3).toMatchObject({ raised: 1, other: 1, earnedShare: null });
});

it('filters by language and picks the checklist version most evaluations used, or the requested one', () => {
  const conversations = [conv('a', 'RU'), conv('b', 'RU'), conv('c', 'KZ')];
  const evaluations = [
    ev('e1', 'a', 'c1', [r('x1', 10), r('x2', true), r('x3', false)], 20),
    ev('e2', 'b', 'c2', [r('x1', 0), r('x2', false), r('x3', false)], 0),
    ev('e3', 'c', 'c2', [r('x1', 5), r('x2', true), r('x3', false)], 15),
  ];
  const all = computeStats({ ...base, conversations, evaluations, appeals: [] });
  expect(all.checklist?.id).toBe('c2'); // two evaluations beat one
  expect(computeStats({ ...base, conversations, evaluations, appeals: [], checklistId: 'c1' }).checklist?.id).toBe('c1');
  const ru = computeStats({ ...base, conversations, evaluations, appeals: [], language: 'RU' });
  expect(ru).toMatchObject({ dialogs: 2, evaluated: 2, averageTotal: 10 });
  expect(ru.byLanguage.map((l) => l.language)).toEqual(['KZ', 'RU']); // the language table is never narrowed by the filter
});

it('separates appeals from direct corrections and counts results a reviewer changed', () => {
  const conversations = [conv('a', 'RU')];
  const original = [r('x1', 0), r('x2', true), r('x3', false)];
  const final = [r('x1', 10, { source: 'reviewer' }), r('x2', true), r('x3', false)];
  const evaluations = [ev('e1', 'a', 'c1', original, 10, { finalResults: final, finalTotal: 20 })];
  const appeals = [appeal('p1', 'e1', 'pending'), appeal('p2', 'e1', 'upheld'), appeal('p3', 'e1', 'overridden'), appeal('p4', 'e1', 'overridden', 'correction'), appeal('p5', 'other', 'pending')];
  const s = computeStats({ ...base, conversations, evaluations, appeals });
  expect(s.appeals).toEqual({ pending: 1, upheld: 1, overridden: 1, corrections: 1 });
  expect(s.reviewedResults).toEqual({ total: 3, changed: 1 });
  expect(s.averageTotal).toBe(20); // the total after review, not the AI's first answer
});

it('is empty-safe', () => {
  const s = computeStats({ ...base, conversations: [], evaluations: [], appeals: [] });
  expect(s).toMatchObject({ dialogs: 0, evaluated: 0, averageTotal: null, checklist: null, criteria: [] });
});

it('groups results by assigned operator, counts only appeals of their own dialogs and reviews of the current evaluation', () => {
  const conversations = [{ ...conv('a', 'RU'), operatorId: 'Алина', review: { status: 'reviewed' as const, evaluationId: 'ea', by: 'М', at: '2026-11-08T00:00:00Z' } }, { ...conv('b', 'RU'), operatorId: 'Алина', review: { status: 'reviewed' as const, evaluationId: 'older', by: 'М', at: '2026-11-08T00:00:00Z' } }, { ...conv('c', 'RU'), operatorId: 'Тимур' }, conv('d', 'RU')];
  const evaluations = [
    ev('ea', 'a', 'c1', [r('x1', 10), r('x2', true), r('x3', false)], 20),
    ev('eb', 'b', 'c1', [r('x1', 0), r('x2', true), r('x3', true)], 10),
    ev('ec', 'c', 'c1', [r('x1', 5), r('x2', true), r('x3', false)], 15),
  ];
  const appeals = [appeal('p1', 'eb', 'pending'), appeal('p2', 'ec', 'upheld'), appeal('fix', 'eb', 'overridden', 'correction')];
  const s = computeStats({ ...base, conversations, evaluations, appeals });
  const row = (o: string | null) => s.byOperator.find((x) => x.operator === o)!;
  expect(s.byOperator.map((x) => x.operator)).toEqual(['Алина', 'Тимур', null]);
  expect(row('Алина')).toMatchObject({ dialogs: 2, evaluated: 2, seriousViolations: 1, reviewed: 1, appealsPending: 1, appealsTotal: 1 }); // b's check is of an older evaluation
  expect(row('Тимур')).toMatchObject({ appealsTotal: 1, appealsPending: 0, reviewed: 0 });
  expect(row(null)).toMatchObject({ dialogs: 1, evaluated: 0 });
  expect(s.review).toEqual({ new: 3, in_review: 0, reviewed: 1 });
});
