import type { AssistedDetector } from '../detectors/types.js';
import { needsDetector } from './needs.js';
import { consultationDetector } from './consultation.js';
import { dialogueDetector } from './dialogue.js';

/** Internal rubric implementations, selected only after canonical signature matching. */
export const ORIGINAL_SEMANTIC_HELPERS: Record<string, AssistedDetector<any>> = {
  '02': needsDetector, '04': consultationDetector, '06': dialogueDetector,
};
export type DecisionFacts = Record<string, { kind: string; facts: unknown }>;
