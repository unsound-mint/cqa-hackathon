import { z } from 'zod';
import { AppealStatusSchema, ChannelSchema, CriterionValueSchema, EvaluationStatusSchema, LanguageSchema } from './domain.js';

/** Request/response shapes shared by MockCqaApi, HttpCqaApi and the Fastify routes. */

export const ListConversationsQuerySchema = z.object({
  language: LanguageSchema.optional(),
  channel: ChannelSchema.optional(),
});
export type ListConversationsQuery = z.infer<typeof ListConversationsQuerySchema>;

export const StartEvaluationInputSchema = z.object({
  conversationIds: z.array(z.string().min(1)).min(1),
  checklistVersionId: z.string().min(1),
  /** Bypass cached results and evaluate the current input again. */
  force: z.boolean().optional(),
  /** Compatibility alias used by the stability runner. Same behavior as force. */
  fresh: z.boolean().optional(),
});
export type StartEvaluationInput = z.infer<typeof StartEvaluationInputSchema>;

export const JobSchema = z.object({
  id: z.string().min(1),
  status: EvaluationStatusSchema,
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** v0.1 addition: how to get from a job to its evaluations. Filled as they are created. */
  evaluationIds: z.array(z.string()),
});
export type Job = z.infer<typeof JobSchema>;

/** Appeals of one evaluation, and/or only those in a status. Without `evaluationId` it lists across all dialogs (the approver's queue). */
export const ListAppealsQuerySchema = z.object({ evaluationId: z.string().min(1).optional(), status: AppealStatusSchema.optional() });
export type ListAppealsQuery = z.infer<typeof ListAppealsQuerySchema>;

export const ListEvaluationsQuerySchema = z.object({ conversationId: z.string().optional() });
export type ListEvaluationsQuery = z.infer<typeof ListEvaluationsQuerySchema>;

export const CreateAppealInputSchema = z.object({
  evaluationId: z.string().min(1),
  criterionId: z.string().min(1),
  comment: z.string().min(1),
});
export type CreateAppealInput = z.infer<typeof CreateAppealInputSchema>;

export const DecideAppealInputSchema = z
  .object({
    appealId: z.string().min(1),
    action: z.enum(['uphold', 'override']),
    reason: z.string().min(1),
    value: CriterionValueSchema.nullable().optional(),
    isNA: z.boolean().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.action === 'override' && !d.isNA && (d.value === undefined || d.value === null)) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'override needs a value, or isNA=true' });
    }
  });
export type DecideAppealInput = z.infer<typeof DecideAppealInputSchema>;

/** A reviewer changes one criterion directly (no appeal first). Refused while that criterion has a pending appeal. */
export const OverrideCriterionInputSchema = z
  .object({
    evaluationId: z.string().min(1),
    criterionId: z.string().min(1),
    reason: z.string().min(1),
    value: CriterionValueSchema.nullable().optional(),
    isNA: z.boolean().optional(),
  })
  .superRefine((d, ctx) => {
    if (!d.isNA && (d.value === undefined || d.value === null)) ctx.addIssue({ code: 'custom', path: ['value'], message: 'override needs a value, or isNA=true' });
  });
export type OverrideCriterionInput = z.infer<typeof OverrideCriterionInputSchema>;
