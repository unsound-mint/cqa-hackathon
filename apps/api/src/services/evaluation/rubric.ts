import { criterionSignature, type Criterion } from '@cqa/contracts';
import original from '../../checklists/original.json';

const bySignature = new Map((original.criteria as Criterion[]).map(c => [criterionSignature(c), c]));

/** Wording, scale and applicability determine semantics; ids, titles and weights may change safely. */
export function originalCriterion(criterion: Criterion): Criterion | undefined {
  return bySignature.get(criterionSignature(criterion));
}
