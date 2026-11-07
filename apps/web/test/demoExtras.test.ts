import { DemoBundleSchema, findEvidenceProblems } from '@cqa/contracts';
import { expect, it } from 'vitest';
import { richDemo } from '../src/api/demoExtras';

it('the mock extras are valid fictional data: schema, grounded evidence, scorer-made totals', () => {
  const b = richDemo();
  expect(() => DemoBundleSchema.parse(b)).not.toThrow();
  expect(b.conversations.length).toBeGreaterThan(1);
  for (const e of b.evaluations) {
    const c = b.conversations.find((x) => x.id === e.conversationId)!;
    expect(findEvidenceProblems(c, e.finalResults)).toEqual([]);
  }
  const en = b.evaluations.find((e) => e.conversationId === 'demo-en-007')!;
  expect(en.seriousViolation).toBe(true);
  const call = b.evaluations.find((e) => e.conversationId === 'demo-ru-023')!;
  expect(call.finalResults.some((r) => r.confidence === 'low')).toBe(true);
  expect(b.conversations.some((c) => !b.evaluations.some((e) => e.conversationId === c.id))).toBe(true); // one unevaluated dialog
});
