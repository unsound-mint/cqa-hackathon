import { z } from 'zod';
import { ChannelSchema, CriterionValueSchema, EvaluationStatusSchema, LanguageSchema } from './domain.js';

/** Request/response shapes shared by MockCqaApi, HttpCqaApi and the Fastify routes. */

export const ListConversationsQuerySchema = z.object({
  language: LanguageSchema.optional(),
  channel: ChannelSchema.optional(),
});
export type ListConversationsQuery = z.infer<typeof ListConversationsQuerySchema>;

export const StartEvaluationInputSchema = z.object({
  conversationIds: z.array(z.string().min(1)).min(1),
  checklistVersionId: z.string().min(1),
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

/** GET /api/insights/agent-improvements: where the evaluated agent could be made deterministic (v0.1 addition). */
export const AgentImprovementsSchema = z.object({
  checklistVersionId: z.string(),
  evaluations: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      criterionId: z.string(),
      title: z.string(),
      agentHint: z.string(),
      /** True when a deterministic detector decides this criterion, so the failure is provable by rule. */
      ruleCheckable: z.boolean(),
      evaluated: z.number().int().nonnegative(),
      shortfalls: z.number().int().nonnegative(),
      conversationIds: z.array(z.string()),
    }),
  ),
});
export type AgentImprovements = z.infer<typeof AgentImprovementsSchema>;
