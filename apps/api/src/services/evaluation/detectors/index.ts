import { closingDetector } from './closing.js';
import { greetingIntroDetector } from './greeting.js';
import type { AssistedDetector, Detector } from './types.js';
import { verificationDetector } from './verification.js';

/** Pure rules: decide from the transcript alone, or abstain. */
export const DETECTORS: Record<string, Detector> = Object.fromEntries([greetingIntroDetector, closingDetector].map((d) => [d.name, d]));

/** Code decides; the model supplies a few narrow facts. */
export const ASSISTED_DETECTORS: Record<string, AssistedDetector<any>> = Object.fromEntries([verificationDetector].map((d) => [d.name, d]));

export const isKnownDetector = (name: string) => name in DETECTORS || name in ASSISTED_DETECTORS;

export const listDetectors = () => [
  ...Object.values(DETECTORS).map(({ name, description }) => ({ name, description, kind: 'rule' as const })),
  ...Object.values(ASSISTED_DETECTORS).map(({ name, description }) => ({ name, description, kind: 'assisted' as const })),
];
export type { AssistedDetector, Detector } from './types.js';
