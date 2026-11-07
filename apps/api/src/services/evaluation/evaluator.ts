import { CriterionResultSchema, findEvidenceProblems, scoreEvaluation, type ChecklistVersion, type Conversation, type CriterionResult, type Provenance } from '@cqa/contracts';
import { z } from 'zod';
import { OUTPUT_SCHEMA, PROMPT_VERSION, SYSTEM_PROMPT } from './prompts.js';
import type { LlmProvider } from './provider.js';

export class EvaluationFailure extends Error {}

/**
 * System-event phrasings that confirm identity verification (RU/KZ/EN, from the organizer's data).
 * Extend here when a new phrasing appears; the model is told these events are the only proof.
 */
export const IDENTITY_VERIFIED_PATTERNS = [/личност\p{L}*\s+клиента\s+подтвержд/iu, /жеке\s+басы\s+расталды/iu, /identity\s+(?:was\s+|has\s+been\s+)?verified/iu];

/** Deterministic facts derived from the transcript; given to the model as context, never re-derived by it. */
export function deriveContext(c: Conversation) {
  const t = c.transcript;
  return {
    messageCount: t.length,
    firstOperatorIndex: t.find((m) => m.speaker === 'operator')?.index ?? null,
    operatorMessageIndices: t.filter((m) => m.speaker === 'operator').map((m) => m.index),
    identityVerificationEvents: t.filter((m) => m.speaker === 'system' && IDENTITY_VERIFIED_PATTERNS.some((re) => re.test(m.text))).map((m) => m.index),
    systemMessages: t.filter((m) => m.speaker === 'system').map((m) => ({ index: m.index, text: m.text })),
  };
}

function buildUserPayload(c: Conversation, checklist: ChecklistVersion, problems: string[]) {
  return JSON.stringify({
    checklist: {
      id: checklist.id,
      criteria: checklist.criteria.map(({ id, title, instructions, kind, allowedValues, allowNA, naCondition, weight, criticalFlag }) => ({
        id, title, instructions, kind, allowedValues, allowNA, naCondition, weight, flagOnly: criticalFlag === true,
      })),
    },
    derivedFacts: deriveContext(c),
    conversation: { language: c.language, channel: c.channel, transcript: c.transcript },
    ...(problems.length ? { previousAnswerProblems: problems } : {}),
  });
}

const RawSchema = z.object({ results: z.array(z.unknown()) });

/** Strict validation of untrusted model output. Returns accepted results or a list of problems; never repairs. */
export function validateModelOutput(output: unknown, conversation: Conversation, checklist: ChecklistVersion): { results?: CriterionResult[]; problems: string[] } {
  const raw = RawSchema.safeParse(output);
  if (!raw.success) return { problems: ['output must be { results: [...] }'] };
  const problems: string[] = [];
  const parsed: CriterionResult[] = [];
  raw.data.results.forEach((r, i) => {
    const p = CriterionResultSchema.safeParse(r);
    if (p.success) parsed.push(p.data);
    else problems.push(`results[${i}]: ${p.error.issues[0]?.message ?? 'invalid'}`);
  });

  const byId = new Map<string, CriterionResult>();
  for (const r of parsed) {
    if (byId.has(r.criterionId)) problems.push(`duplicate result for ${r.criterionId}`);
    byId.set(r.criterionId, r);
  }
  for (const id of byId.keys()) if (!checklist.criteria.some((c) => c.id === id)) problems.push(`unknown criterion ${id}`);
  for (const c of checklist.criteria) {
    const r = byId.get(c.id);
    if (!r) {
      problems.push(`missing result for ${c.id}`);
      continue;
    }
    if (r.isNA) {
      if (!c.allowNA) problems.push(`${c.id}: N/A is not allowed`);
      if (!r.naReason) problems.push(`${c.id}: N/A needs naReason`);
    } else if (!c.allowedValues.includes(r.value as never)) {
      problems.push(`${c.id}: value ${JSON.stringify(r.value)} is not one of ${JSON.stringify(c.allowedValues)}`);
    }
    if (r.evidence.length === 0 && !r.checkedRange) problems.push(`${c.id}: needs evidence or checkedRange`);
  }
  problems.push(...findEvidenceProblems(conversation, parsed));
  if (problems.length) return { problems };
  return { results: checklist.criteria.map((c) => byId.get(c.id)!), problems: [] };
}

export type EvaluatorResult = {
  results: CriterionResult[];
  total: number | null;
  seriousViolation: boolean;
  provenance: Provenance;
  usage: { inputTokens: number; outputTokens: number };
};

/** One model call per conversation (all criteria), one repair attempt with the validator's complaints. */
export async function evaluateConversation(provider: LlmProvider, conversation: Conversation, checklist: ChecklistVersion, maxAttempts = 2): Promise<EvaluatorResult> {
  let problems: string[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await provider.complete({ system: SYSTEM_PROMPT, user: buildUserPayload(conversation, checklist, problems), outputSchema: OUTPUT_SCHEMA as unknown as Record<string, unknown> });
    usage.inputTokens += res.usage?.inputTokens ?? 0;
    usage.outputTokens += res.usage?.outputTokens ?? 0;
    const v = validateModelOutput(res.output, conversation, checklist);
    if (v.results) {
      const { total, seriousViolation } = scoreEvaluation(checklist, v.results);
      return { results: v.results, total, seriousViolation, provenance: { provider: provider.name, model: provider.model, promptVersion: PROMPT_VERSION }, usage };
    }
    problems = v.problems;
  }
  throw new EvaluationFailure(`model output failed validation: ${problems.slice(0, 5).join('; ')}`);
}
