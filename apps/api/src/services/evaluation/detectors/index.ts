import { closingDetector } from './closing.js';
import { greetingIntroDetector } from './greeting.js';
import type { Detector } from './types.js';

export const DETECTORS: Record<string, Detector> = Object.fromEntries([greetingIntroDetector, closingDetector].map((d) => [d.name, d]));

export const listDetectors = () => Object.values(DETECTORS).map(({ name, description }) => ({ name, description }));
export type { Detector } from './types.js';
