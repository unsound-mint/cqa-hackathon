import type { CriterionResult, Evaluation } from '@cqa/contracts';
import { describe, expect, it } from 'vitest';
import { formatStability, stability } from '../src/stability.js';
import { checklist, evaluation } from './fixture.js';

const withValues = (id: string, patch: Record<string, Partial<CriterionResult>>, total = evaluation.originalTotal, conversationId = evaluation.conversationId): Evaluation => ({
  ...evaluation,
  id,
  conversationId,
  originalTotal: total,
  originalResults: evaluation.originalResults.map((r) => ({ ...r, ...(patch[r.criterionId] ?? {}) })),
});

describe('stability', () => {
  it('reports nothing to compare with a single run per conversation', () => {
    const r = stability([evaluation], checklist);
    expect(r.conversations).toBe(0);
    expect(formatStability(r)).toMatch(/two completed runs/);
  });

  it('counts a criterion as unstable when its value changed between runs, per source, and ranges the total', () => {
    const a = withValues('a', { '04': { source: 'model' }, '01': { source: 'rule' } });
    const b = withValues('b', { '04': { value: 10, source: 'model' }, '01': { source: 'rule' } }, 80);
    const r = stability([a, b], checklist);
    expect(r.conversations).toBe(1);
    expect(r.runsPerConversation).toEqual({ min: 2, max: 2 });
    expect(r.criteria.find((c) => c.id === '04')).toMatchObject({ n: 1, unstable: 1, flipRate: 1, bySource: { model: { n: 1, unstable: 1 } } });
    expect(r.criteria.find((c) => c.id === '01')).toMatchObject({ n: 1, unstable: 0, bySource: { rule: { n: 1, unstable: 0 } } });
    expect(r.totalRange.max).toBe(Math.round((evaluation.originalTotal! - 80) * 100) / 100);
    expect(r.totalRange.unstableConversations).toBe(1);
  });

  it('N/A versus a value counts as a change', () => {
    const a = withValues('a', {});
    const b = withValues('b', { '04': { value: null, isNA: true, naReason: 'x' } });
    expect(stability([a, b], checklist).criteria.find((c) => c.id === '04')).toMatchObject({ unstable: 1 });
  });

  it('ignores results copied from an earlier run, failed runs and other checklist versions', () => {
    const a = withValues('a', {});
    const reused = withValues('b', { '04': { value: 5, reusedFrom: 'a' } });
    const failed: Evaluation = { ...withValues('c', {}), status: 'failed' };
    const other: Evaluation = { ...withValues('d', {}), checklistVersionId: 'other' };
    const r = stability([a, reused, failed, other], checklist);
    expect(r.criteria.find((c) => c.id === '04')).toMatchObject({ n: 0, unstable: 0, flipRate: null });
  });

  it('keeps conversations separate', () => {
    const r = stability([withValues('a', {}), withValues('b', {}, 50, 'c2'), withValues('c', {}, 50, 'c2')], checklist);
    expect(r.conversations).toBe(1); // only c2 has two runs
  });
});
