import { z } from 'zod';
import { ChecklistVersionSchema, ConversationSchema, EvaluationSchema } from './domain.js';

/** Shape of fixtures/demo.json (fictional data only). Unknown keys such as `_comment` are ignored. */
export const DemoBundleSchema = z.object({
  conversations: z.array(ConversationSchema),
  checklists: z.array(ChecklistVersionSchema),
  evaluations: z.array(EvaluationSchema),
});
export type DemoBundle = z.infer<typeof DemoBundleSchema>;
