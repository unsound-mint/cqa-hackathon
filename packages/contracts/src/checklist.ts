import type { Criterion } from './domain.js';

/**
 * Everything that determines what a criterion MEANS for the person/model deciding it. Two criteria with the
 * same signature produce interchangeable results, so a stored result can be reused across checklist versions.
 * Deliberately excluded: weight, title, section (they change scoring/presentation, not the decision).
 */
export function criterionSignature(c: Criterion): string {
  return JSON.stringify([c.instructions, c.kind, c.allowedValues, c.allowNA, c.naCondition ?? null, c.criticalFlag ?? false, c.detector ?? null]);
}
