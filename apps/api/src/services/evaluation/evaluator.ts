import { CriterionResultSchema, criterionSignature, findEvidenceProblems, scoreEvaluation, type ChecklistVersion, type Criterion, type Conversation, type CriterionResult, type Provenance } from '@cqa/contracts';
import { z } from 'zod';
import { DETECTORS } from './detectors/index.js';
import { deriveFacts } from './facts.js';
import { OUTPUT_SCHEMA, PROMPT_VERSION, SYSTEM_PROMPT } from './prompts.js';
import type { LlmProvider } from './provider.js';

export class EvaluationFailure extends Error {}

export { IDENTITY_VERIFIED_PATTERNS, deriveFacts as deriveContext } from './facts.js';

function buildUserPayload(c: Conversation, checklist: Pick<ChecklistVersion, 'id' | 'criteria'>, decided: CriterionResult[], problems: string[]) {
  return JSON.stringify({
    checklist: {
      id: checklist.id,
      criteria: checklist.criteria.map(({ id, title, instructions, kind, allowedValues, allowNA, naCondition, weight, criticalFlag }) => ({
        id, title, instructions, kind, allowedValues, allowNA, naCondition, weight, flagOnly: criticalFlag === true,
      })),
    },
    /** Criteria already settled by code or reused. Context only: do not re-evaluate or contradict them. */
    alreadyDecided: decided.map((r) => ({ criterionId: r.criterionId, value: r.value, isNA: r.isNA, explanation: r.explanation })),
    derivedFacts: deriveFacts(c),
    conversation: { language: c.language, channel: c.channel, transcript: c.transcript },
    ...(problems.length ? { previousAnswerProblems: problems } : {}),
  });
}

const RawSchema = z.object({ results: z.array(z.unknown()) });

/** Strict validation of untrusted model output. Returns accepted results or a list of problems; never repairs. */
export function validateModelOutput(output: unknown, conversation: Conversation, checklist: Pick<ChecklistVersion, 'criteria'>): { results?: CriterionResult[]; problems: string[] } {
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

export type ReuseLookup = (signature: string) => { result: CriterionResult; evaluationId: string } | undefined;

export type Plan = { decided: Map<string, CriterionResult>; undecided: Criterion[] };

/**
 * Resolves each criterion without a model where it can: 1) its deterministic detector (if the checklist names
 * one), 2) an earlier result for the same conversation whose criterion has the same signature (so weight changes
 * and switched-off criteria never cost a model call). Whatever is left is `undecided` and goes to the model.
 */
export function planCriteria(conversation: Conversation, checklist: ChecklistVersion, reuse?: ReuseLookup): Plan {
  const facts = deriveFacts(conversation);
  const decided = new Map<string, CriterionResult>();
  const undecided: Criterion[] = [];
  for (const criterion of checklist.criteria) {
    const detected = criterion.detector ? DETECTORS[criterion.detector]?.run({ conversation, facts, criterion }) : null;
    if (detected) {
      decided.set(criterion.id, detected);
      continue;
    }
    const prior = reuse?.(criterionSignature(criterion));
    if (prior) {
      decided.set(criterion.id, { ...structuredClone(prior.result), criterionId: criterion.id, reusedFrom: prior.evaluationId });
      continue;
    }
    undecided.push(criterion);
  }
  return { decided, undecided };
}

export type EvaluatorResult = {
  results: CriterionResult[];
  total: number | null;
  seriousViolation: boolean;
  provenance: Provenance;
  usage: { inputTokens: number; outputTokens: number };
  /** Criteria the model actually decided in this run (empty when rules and reuse covered everything). */
  modelCriteria: string[];
};

/**
 * Rules and reuse first; one model call (with one repair attempt) only for what is still undecided.
 * The model cannot set `source`/`reusedFrom`: code stamps them. Totals are always computed by code.
 */
export async function evaluateConversation(provider: LlmProvider | undefined, conversation: Conversation, checklist: ChecklistVersion, reuse?: ReuseLookup, maxAttempts = 2): Promise<EvaluatorResult> {
  const { decided, undecided } = planCriteria(conversation, checklist, reuse);
  const usage = { inputTokens: 0, outputTokens: 0 };
  const modelResults = new Map<string, CriterionResult>();
  let provenance: Provenance = { provider: 'local', model: 'rules+reuse', promptVersion: 'n/a' };

  if (undecided.length > 0) {
    if (!provider) throw new EvaluationFailure(`a model is required for criteria: ${undecided.map((c) => c.id).join(', ')}`);
    const subset = { id: checklist.id, criteria: undecided };
    let problems: string[] = [];
    let ok = false;
    for (let attempt = 1; attempt <= maxAttempts && !ok; attempt++) {
      const res = await provider.complete({ system: SYSTEM_PROMPT, user: buildUserPayload(conversation, subset, [...decided.values()], problems), outputSchema: OUTPUT_SCHEMA as unknown as Record<string, unknown> });
      usage.inputTokens += res.usage?.inputTokens ?? 0;
      usage.outputTokens += res.usage?.outputTokens ?? 0;
      const v = validateModelOutput(res.output, conversation, { ...checklist, criteria: undecided });
      if (v.results) {
        for (const r of v.results) {
          const { reusedFrom: _drop, ...clean } = r;
          modelResults.set(r.criterionId, { ...clean, source: 'model' });
        }
        ok = true;
      } else problems = v.problems;
    }
    if (!ok) throw new EvaluationFailure(`model output failed validation: ${problems.slice(0, 5).join('; ')}`);
    provenance = { provider: provider.name, model: provider.model, promptVersion: PROMPT_VERSION };
  }

  const results = checklist.criteria.map((c) => decided.get(c.id) ?? modelResults.get(c.id)!);
  const { total, seriousViolation } = scoreEvaluation(checklist, results);
  return { results, total, seriousViolation, provenance, usage, modelCriteria: [...modelResults.keys()] };
}
