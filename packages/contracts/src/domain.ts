import { z } from 'zod';

/** Contract v0.1 — see docs/INTERFACES.md (v0) and docs/ARCHITECTURE.md ("Contract v0.1 additions"). Denis owns edits. */

export const SpeakerSchema = z.enum(['client', 'operator', 'bot', 'system']);
export type Speaker = z.infer<typeof SpeakerSchema>;

export const LanguageSchema = z.enum(['RU', 'KZ', 'EN']);
export type Language = z.infer<typeof LanguageSchema>;

export const ChannelSchema = z.enum(['agent chat', 'voice call']);
export type Channel = z.infer<typeof ChannelSchema>;

/** A criterion value: boolean (yes/no), number (scale tier) or string (enum label). */
export const CriterionValueSchema = z.union([z.boolean(), z.number(), z.string()]);
export type CriterionValue = z.infer<typeof CriterionValueSchema>;

// ---------- conversations ----------

export const TranscriptMessageSchema = z.object({
  /** 0-based index in the original array. Stable; never reindexed after filtering. */
  index: z.number().int().nonnegative(),
  /** Original timestamp string (MM:SS or ISO). Never reformatted; may repeat across messages. */
  timestamp: z.string(),
  speaker: SpeakerSchema,
  text: z.string(),
});
export type TranscriptMessage = z.infer<typeof TranscriptMessageSchema>;

export const ConversationSchema = z
  .object({
    /** Original conversation_id. */
    id: z.string().min(1),
    datasetGroupId: z.string(),
    language: LanguageSchema,
    channel: ChannelSchema,
    transcript: z.array(TranscriptMessageSchema).min(1),
    audioUrl: z.string().nullable(),
  })
  .superRefine((c, ctx) => {
    c.transcript.forEach((m, i) => {
      if (m.index !== i) {
        ctx.addIssue({
          code: 'custom',
          path: ['transcript', i, 'index'],
          message: `message index ${m.index} must equal its array position ${i}`,
        });
      }
    });
  });
export type Conversation = z.infer<typeof ConversationSchema>;

// ---------- checklists ----------

export const CriterionKindSchema = z.enum(['boolean', 'discrete-scale', 'enum']);
export type CriterionKind = z.infer<typeof CriterionKindSchema>;

export const CriterionSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    sectionId: z.string().optional(),
    /** Model/reviewer instructions. The evaluator applies this text; it never switches on `id`. */
    instructions: z.string(),
    /** Weight in points before N/A redistribution. 0 = flag-only (not part of the total). */
    weight: z.number().nonnegative(),
    kind: CriterionKindSchema,
    /** boolean: [true,false]; discrete-scale: the numeric tiers; enum: the labels. */
    allowedValues: z.array(CriterionValueSchema).min(1),
    allowNA: z.boolean(),
    naCondition: z.string().optional(),
    /** Separate serious-violation flag: a `true` result sets Evaluation.seriousViolation, never changes the score. */
    criticalFlag: z.boolean().optional(),
    /** Name of a deterministic rule that may decide this criterion without a model (see GET /api/detectors). Absent = model decides. */
    detector: z.string().min(1).optional(),
    /** How the evaluated agent could guarantee this deterministically (template, gate, automatic message). Shown when the criterion fails. */
    agentHint: z.string().optional(),
  })
  .superRefine((c, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: 'custom', path: ['allowedValues'], message });
    if (c.kind === 'boolean' && !(c.allowedValues.length === 2 && c.allowedValues.includes(true) && c.allowedValues.includes(false))) {
      bad('boolean criterion must allow exactly [true, false]');
    }
    if (c.kind === 'discrete-scale') {
      const nums = c.allowedValues.filter((v): v is number => typeof v === 'number');
      if (nums.length !== c.allowedValues.length || nums.length < 2 || Math.max(...nums) <= 0 || nums.some((n) => n < 0)) {
        bad('discrete-scale criterion needs >=2 non-negative numeric tiers with a positive maximum');
      }
    }
    if (c.kind === 'enum') {
      if (c.allowedValues.some((v) => typeof v !== 'string')) bad('enum criterion values must be strings');
      if (c.weight !== 0) ctx.addIssue({ code: 'custom', path: ['weight'], message: 'enum criteria have no numeric meaning in v0; weight must be 0' });
    }
    if (c.criticalFlag && c.kind !== 'boolean') {
      ctx.addIssue({ code: 'custom', path: ['criticalFlag'], message: 'critical flag criteria must be boolean' });
    }
    if (c.criticalFlag && c.weight !== 0) {
      ctx.addIssue({ code: 'custom', path: ['weight'], message: 'critical flag criteria must have weight 0' });
    }
    if (new Set(c.allowedValues).size !== c.allowedValues.length) bad('allowedValues must be unique');
  });
export type Criterion = z.infer<typeof CriterionSchema>;

export const ChecklistSectionSchema = z.object({ id: z.string().min(1), title: z.string().min(1) });

const checklistFields = {
  title: z.string().min(1),
  sections: z.array(ChecklistSectionSchema).optional(),
  criteria: z.array(CriterionSchema).min(1),
};

function checkChecklist(
  c: { sections?: { id: string }[]; criteria: { id: string; sectionId?: string }[] },
  ctx: z.RefinementCtx,
) {
  const ids = new Set<string>();
  c.criteria.forEach((cr, i) => {
    if (ids.has(cr.id)) ctx.addIssue({ code: 'custom', path: ['criteria', i, 'id'], message: `duplicate criterion id ${cr.id}` });
    ids.add(cr.id);
    if (cr.sectionId && !c.sections?.some((s) => s.id === cr.sectionId)) {
      ctx.addIssue({ code: 'custom', path: ['criteria', i, 'sectionId'], message: `unknown section ${cr.sectionId}` });
    }
  });
}

/** Immutable once saved. Editing = saving a new version. */
export const ChecklistVersionSchema = z
  .object({
    id: z.string().min(1),
    /** Increments per saved checklist lineage, starting at 1. */
    version: z.number().int().positive(),
    ...checklistFields,
    createdAt: z.string(),
  })
  .superRefine(checkChecklist);
export type ChecklistVersion = z.infer<typeof ChecklistVersionSchema>;

export const SaveChecklistInputSchema = z.object(checklistFields).superRefine(checkChecklist);
export type SaveChecklistInput = z.infer<typeof SaveChecklistInputSchema>;

// ---------- evaluations ----------

export const EvidenceReferenceSchema = z.object({
  messageIndex: z.number().int().nonnegative(),
  /** If present, must occur verbatim in that message (verified server-side). */
  quote: z.string().optional(),
});
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const CriterionResultSchema = z
  .object({
    criterionId: z.string().min(1),
    value: CriterionValueSchema.nullable(),
    isNA: z.boolean(),
    naReason: z.string().optional(),
    explanation: z.string(),
    /** Model's own certainty. 'low' (e.g. noisy speech recognition) routes the result to human review. */
    confidence: z.enum(['high', 'medium', 'low']).optional(),
    /** Who decided: a deterministic rule or the model. Absent on older data. */
    source: z.enum(['rule', 'model']).optional(),
    /** Set when copied unchanged from an earlier evaluation of the same conversation (no new decision was made). */
    reusedFrom: z.string().optional(),
    evidence: z.array(EvidenceReferenceSchema),
    /** Inclusive range of ORIGINAL indices inspected; required context for absence claims. */
    checkedRange: z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }).optional(),
  })
  .superRefine((r, ctx) => {
    if (r.isNA && r.value !== null) ctx.addIssue({ code: 'custom', path: ['value'], message: 'N/A result must have value null' });
    if (!r.isNA && r.value === null) ctx.addIssue({ code: 'custom', path: ['value'], message: 'non-N/A result needs a value' });
    if (r.checkedRange && r.checkedRange.from > r.checkedRange.to) {
      ctx.addIssue({ code: 'custom', path: ['checkedRange'], message: 'checkedRange.from must be <= to' });
    }
  });
export type CriterionResult = z.infer<typeof CriterionResultSchema>;

export const EvaluationStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);
export type EvaluationStatus = z.infer<typeof EvaluationStatusSchema>;

export const ProvenanceSchema = z.object({
  /** 'mock' marks fictional fixture output; UI must label it as such. */
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const EvaluationSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  checklistVersionId: z.string().min(1),
  status: EvaluationStatusSchema,
  /** Immutable initial AI output. Reviewer overrides never touch these two fields. */
  originalResults: z.array(CriterionResultSchema),
  originalTotal: z.number().nullable(),
  /** Original results with approved overrides applied; total recomputed deterministically. */
  finalResults: z.array(CriterionResultSchema),
  finalTotal: z.number().nullable(),
  /** Reflects finalResults. The original flag is derivable: deriveSeriousViolation(criteria, originalResults). */
  seriousViolation: z.boolean(),
  provenance: ProvenanceSchema.optional(),
  error: z.string().optional(),
});
export type Evaluation = z.infer<typeof EvaluationSchema>;

// ---------- appeals ----------

export const AppealStatusSchema = z.enum(['pending', 'upheld', 'overridden']);
export type AppealStatus = z.infer<typeof AppealStatusSchema>;

export const AppealSchema = z.object({
  id: z.string().min(1),
  evaluationId: z.string().min(1),
  criterionId: z.string().min(1),
  comment: z.string(),
  status: AppealStatusSchema,
  createdAt: z.string(),
  /** Set when decided. 'upheld' = the original AI result stands. */
  decidedAt: z.string().optional(),
  reviewerReason: z.string().optional(),
  reviewerValue: CriterionValueSchema.nullable().optional(),
  reviewerIsNA: z.boolean().optional(),
});
export type Appeal = z.infer<typeof AppealSchema>;
