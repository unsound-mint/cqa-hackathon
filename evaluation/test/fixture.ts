import { readFileSync } from 'node:fs';
import { DemoBundleSchema } from '@cqa/contracts';

/** Wholly fictional data from fixtures/demo.json. "Human" rows in tests are test devices, never ground truth. */
const bundle = DemoBundleSchema.parse(JSON.parse(readFileSync(new URL('../../fixtures/demo.json', import.meta.url), 'utf8')));
export const checklist = bundle.checklists[0]!;
export const conversation = bundle.conversations[0]!;
export const evaluation = bundle.evaluations[0]!;
