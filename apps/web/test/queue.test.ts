import type { Conversation, Evaluation } from '@cqa/contracts';
import { describe, expect, it } from 'vitest';
import demo from '../../../fixtures/demo.json';
import { DEFAULT_FILTERS, NO_OPERATOR, matches, reviewOf, sortConversations } from '../src/lib/queue';

const base = demo.conversations[0] as unknown as Conversation;
const ev0 = demo.evaluations[0] as unknown as Evaluation;
const conv = (id: string, patch: Partial<Conversation> = {}): Conversation => ({ ...base, id, ...patch });
const ev = (id: string, total: number | null, patch: Partial<Evaluation> = {}): Evaluation => ({ ...ev0, id: `e-${id}`, conversationId: id, finalTotal: total, seriousViolation: false, ...patch });
const latestOf = (...es: Evaluation[]) => new Map(es.map((e) => [e.conversationId, e]));
const ids = (cs: Conversation[]) => cs.map((c) => c.id);
const reviewed = (id: string, status: 'in_review' | 'reviewed' = 'reviewed'): Partial<Conversation> => ({ review: { status, evaluationId: `e-${id}`, by: 'Мария', at: '2026-11-07T10:00:00.000Z' } });

describe('reviewOf', () => {
  it('is new without a review, and a check of an older evaluation is stale (new again)', () => {
    const e = ev('a', 90);
    expect(reviewOf(conv('a'), e)).toEqual({ state: 'new', stale: false });
    expect(reviewOf(conv('a', reviewed('a')), e)).toMatchObject({ state: 'reviewed', stale: false, by: 'Мария' });
    expect(reviewOf(conv('a', reviewed('a')), { ...e, id: 'e-a-newer' })).toMatchObject({ state: 'new', stale: true, by: 'Мария' });
  });
});

describe('sortConversations', () => {
  const cs = [conv('c'), conv('a', reviewed('a')), conv('b'), conv('d')];
  const latest = latestOf(ev('a', 40), ev('b', 80), ev('c', 60, { seriousViolation: true }), ev('d', 70));

  it('queue order: unreviewed first, serious violation before score, lowest score first, reviewed last', () => {
    expect(ids(sortConversations(cs, latest, { key: 'queue', dir: 1 }))).toEqual(['c', 'd', 'b', 'a']);
  });

  it('sorts by import time in both directions, ties by id; a dialog without an import time goes first when ascending', () => {
    const imported = [conv('x', { importedAt: '2026-11-07T09:00:00.000Z' }), conv('y', { importedAt: '2026-11-07T11:00:00.000Z' }), conv('z', { importedAt: '2026-11-07T11:00:00.000Z' }), conv('w')];
    expect(ids(sortConversations(imported, new Map(), { key: 'imported', dir: -1 }))).toEqual(['y', 'z', 'x', 'w']);
    expect(ids(sortConversations(imported, new Map(), { key: 'imported', dir: 1 }))).toEqual(['w', 'x', 'y', 'z']);
  });

  it('sorts by score with dialogs that have none at the end of a low-first order, and never mutates its input', () => {
    const input = [conv('n'), conv('a'), conv('b')];
    const copy = [...input];
    expect(ids(sortConversations(input, latestOf(ev('a', 90), ev('b', 30)), { key: 'score', dir: 1 }))).toEqual(['b', 'a', 'n']);
    expect(input).toEqual(copy);
  });
});

describe('matches', () => {
  it('filters by review state and by operator, including dialogs nobody has', () => {
    const e = ev('a', 90);
    const mine = conv('a', { operatorId: 'Алина' });
    const free = conv('b');
    expect(matches(mine, e, { ...DEFAULT_FILTERS, operator: 'Алина' })).toBe(true);
    expect(matches(mine, e, { ...DEFAULT_FILTERS, operator: 'Тимур' })).toBe(false);
    expect(matches(free, e, { ...DEFAULT_FILTERS, operator: NO_OPERATOR })).toBe(true);
    expect(matches(mine, e, { ...DEFAULT_FILTERS, operator: NO_OPERATOR })).toBe(false);
    expect(matches(mine, e, { ...DEFAULT_FILTERS, review: 'new' })).toBe(true);
    expect(matches(conv('a', reviewed('a')), e, { ...DEFAULT_FILTERS, review: 'new' })).toBe(false);
    expect(matches(conv('a', reviewed('a')), e, { ...DEFAULT_FILTERS, review: 'reviewed' })).toBe(true);
  });
});
