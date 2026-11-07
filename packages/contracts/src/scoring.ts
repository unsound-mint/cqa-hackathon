import type { ChecklistVersion, Criterion, CriterionResult } from './domain.js';

/**
 * THE single total calculation (docs/RUBRIC.md "Calculation"). Driven only by criterion
 * kind / allowedValues / weight / allowNA — never by criterion id. Fails closed on invalid input.
 * Used by MockCqaApi and the API; extend this module, never copy it.
 *
 * Rounding decision (docs/RUBRIC.md leaves halfway cases open): two decimals, halves round away from
 * zero, judged on the decimal value. The product is first cleaned to 12 significant digits so binary
 * noise such as 28.499999999999996 is treated as the 28.5 it represents. Change only with a human decision.
 */

export class ScoringError extends Error {}

function normalized(c: Criterion, value: NonNullable<CriterionResult['value']>): number {
  if (c.kind === 'boolean') return value === true ? 1 : 0;
  if (c.kind === 'discrete-scale') {
    // Top tier gives full weight (rubric step 3).
    return (value as number) / Math.max(...(c.allowedValues as number[]));
  }
  // enum criteria are weight 0 (enforced by the schema); they never reach the sums with weight > 0.
  throw new ScoringError(`criterion ${c.id}: enum criteria cannot carry weight`);
}

export function roundTo2(x: number): number {
  const scaled = Number((Math.abs(x) * 100).toPrecision(12));
  return (Math.sign(x) * Math.round(scaled)) / 100;
}

/** Weighted 0..100 total over applicable criteria, or null when no weighted criterion applies. */
export function computeTotal(criteria: readonly Criterion[], results: readonly CriterionResult[]): number | null {
  const byId = new Map<string, CriterionResult>();
  for (const r of results) {
    if (byId.has(r.criterionId)) throw new ScoringError(`duplicate result for ${r.criterionId}`);
    byId.set(r.criterionId, r);
  }
  const known = new Set(criteria.map((c) => c.id));
  for (const id of byId.keys()) if (!known.has(id)) throw new ScoringError(`result for unknown criterion ${id}`);

  let earned = 0;
  let applicable = 0;
  for (const c of criteria) {
    const r = byId.get(c.id);
    if (!r) throw new ScoringError(`missing result for criterion ${c.id}`);
    if (r.isNA) {
      if (!c.allowNA) throw new ScoringError(`N/A is not allowed for criterion ${c.id}`);
      continue;
    }
    if (r.value === null) throw new ScoringError(`criterion ${c.id}: non-N/A result needs a value`);
    if (!c.allowedValues.includes(r.value)) {
      throw new ScoringError(`value ${JSON.stringify(r.value)} is not allowed for criterion ${c.id}`);
    }
    earned += c.weight > 0 ? c.weight * normalized(c, r.value) : 0;
    applicable += c.weight;
  }
  return applicable === 0 ? null : roundTo2((100 * earned) / applicable);
}

/** Serious-violation flag: any critical criterion answered `true`. Separate from the score. */
export function deriveSeriousViolation(criteria: readonly Criterion[], results: readonly CriterionResult[]): boolean {
  const critical = new Set(criteria.filter((c) => c.criticalFlag).map((c) => c.id));
  return results.some((r) => critical.has(r.criterionId) && !r.isNA && r.value === true);
}

export function scoreEvaluation(checklist: Pick<ChecklistVersion, 'criteria'>, results: readonly CriterionResult[]) {
  return {
    total: computeTotal(checklist.criteria, results),
    seriousViolation: deriveSeriousViolation(checklist.criteria, results),
  };
}
