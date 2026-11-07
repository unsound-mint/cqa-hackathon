import { CriterionResultSchema, criterionSignature, findEvidenceProblems, scoreEvaluation, type ChecklistVersion, type Criterion, type Conversation, type CriterionResult, type Provenance } from '@cqa/contracts';
import { z } from 'zod';
import { ASSISTED_DETECTORS, DETECTORS } from './detectors/index.js';
import type { AssistedDetector } from './detectors/types.js';
import { deriveFacts } from './facts.js';
import { PROMPT_VERSION, systemPromptFor } from './prompts.js';
import { originalCriterion } from './rubric.js';
import { ORIGINAL_SEMANTIC_HELPERS, type DecisionFacts } from './semantic/index.js';
import { buildOutputSchema } from './output-schema.js';
import type { LlmProvider } from './provider.js';

export class EvaluationFailure extends Error {}

export { IDENTITY_VERIFIED_PATTERNS, deriveFacts as deriveContext } from './facts.js';

function buildUserPayload(c: Conversation, checklist: Pick<ChecklistVersion, 'id' | 'criteria'>, decided: CriterionResult[], assisted: AssistedItem[], problems: string[]) {
  const relevant = [...checklist.criteria, ...assisted.map(a => a.criterion)];
  const facts = deriveFacts(c);
  // Original criteria exclude first-response SLA. Custom timing criteria retain the complete facts.
  const { secondsFromOperatorJoinToFirstOperatorMessage: _sla, ...nonSlaFacts } = facts;
  const derivedFacts = relevant.every(criterion => originalCriterion(criterion)) ? {
    ...nonSlaFacts,
    largestGapsBetweenMessages: facts.largestGapsBetweenMessages.filter(g => facts.firstOperatorIndex !== null && g.fromIndex >= facts.firstOperatorIndex),
  } : facts;
  return JSON.stringify({
    responseLanguage: c.language,
    checklist: {
      id: checklist.id,
      criteria: checklist.criteria.map(({ id, title, instructions, kind, allowedValues, allowNA, naCondition, weight, criticalFlag }) => ({
        id, title, instructions, kind, allowedValues, allowNA, naCondition, weight, flagOnly: criticalFlag === true,
      })),
    },
    /** Narrow questions for criteria whose verdict is computed by code from your answers. Answer them in "assisted"; do not return a result for these criteria. */
    assistedQuestions: assisted.map(({ criterion, detector }) => ({ criterionId: criterion.id, title: criterion.title, instructions: criterion.instructions, question: detector.question, answersSchema: detector.answersJsonSchema })),
    /** Criteria already settled by code or reused. Context only: do not re-evaluate or contradict them. */
    alreadyDecided: decided.map((r) => ({ criterionId: r.criterionId, value: r.value, isNA: r.isNA, explanation: r.explanation })),
    derivedFacts,
    conversation: { language: c.language, channel: c.channel, transcript: c.transcript },
    ...(problems.length ? { previousAnswerProblems: problems } : {}),
  });
}

const AssistedAnswersSchema = z.union([
  // Retain support for provider-neutral adapters that already return the original array representation.
  z.array(z.object({ criterionId: z.string(), answers: z.unknown() })),
  z.record(z.string(), z.unknown()).transform((answers) => Object.entries(answers).map(([criterionId, value]) => ({ criterionId, answers: value }))),
]);
const RawSchema = z.object({ results: z.array(z.unknown()), assisted: AssistedAnswersSchema.optional() });

export type AssistedItem = { criterion: Criterion; detector: AssistedDetector<any> };

/** Strict validation of untrusted model output. Returns accepted results or a list of problems; never repairs. */
export function validateModelOutput(output: unknown, conversation: Conversation, checklist: Pick<ChecklistVersion, 'criteria'>): { results?: CriterionResult[]; problems: string[] } {
  const raw = RawSchema.safeParse(output);
  if (!raw.success) return { problems: ['output must be { results: [...] }'] };
  const problems: string[] = [];
  const parsed: CriterionResult[] = [];
  const facts = deriveFacts(conversation);
  const enumBasis = new Map<string, unknown>();
  raw.data.results.forEach((r, i) => {
    const p = CriterionResultSchema.safeParse(r);
    if (p.success) {
      parsed.push(p.data);
      enumBasis.set(p.data.criterionId, (r as Record<string, unknown>).decisionBasis);
    }
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
    // Context from clients/bots/system events is valid, but cannot prove an operator action.
    const basis = enumBasis.get(c.id);
    if (c.kind === 'enum' && !r.isNA) {
      if (basis !== 'operator_action' && basis !== 'absence') problems.push(`${c.id}: enum needs decisionBasis operator_action or absence`);
      if (basis === 'absence' && !r.checkedRange) problems.push(`${c.id}: absence needs checkedRange`);
    }
    const positiveNumeric = typeof r.value === 'number' && r.value > Math.min(...c.allowedValues.filter((v): v is number => typeof v === 'number'));
    const needsAction = !r.isNA && (r.value === true || positiveNumeric || (c.kind === 'enum' && basis === 'operator_action'));
    if (needsAction && !r.evidence.some((e) => {
      const m = conversation.transcript[e.messageIndex];
      return m?.speaker === 'operator' && !facts.operatorMessagesDuringHold.includes(e.messageIndex)
        && !!e.quote?.trim() && m.text.includes(e.quote);
    })) problems.push(`${c.id}: positive action needs verbatim client-facing operator evidence; bot/system/client evidence is context only`);
    if (r.evidence.length === 0 && !r.checkedRange) problems.push(`${c.id}: needs evidence or checkedRange`);
    // A raised flag (serious violation) is an accusation about the operator: it must point at something the operator said.
    if (c.criticalFlag && r.value === true && !r.evidence.some((x) => x.quote && conversation.transcript[x.messageIndex]?.speaker === 'operator')) {
      problems.push(`${c.id}: a raised flag needs a verbatim quote from an operator message`);
    }
  }
  problems.push(...findEvidenceProblems(conversation, parsed));
  if (problems.length) return { problems };
  return { results: checklist.criteria.map((c) => byId.get(c.id)!), problems: [] };
}

/** Validates the model's answers to the assisted questions. Returns accepted answers per criterion or problems. */
export function validateAssisted(output: unknown, conversation: Conversation, assisted: AssistedItem[]): { answers: Map<string, unknown>; problems: string[] } {
  const answers = new Map<string, unknown>();
  const problems: string[] = [];
  if (assisted.length === 0) return { answers, problems };
  const raw = RawSchema.safeParse(output);
  const given = raw.success ? (raw.data.assisted ?? []) : [];
  for (const { criterion, detector } of assisted) {
    const entries = given.filter((g) => g.criterionId === criterion.id);
    if (entries.length !== 1) {
      problems.push(`assisted: expected exactly one answer for ${criterion.id}, got ${entries.length}`);
      continue;
    }
    const v = detector.validate({ conversation, facts: deriveFacts(conversation) }, entries[0]!.answers);
    if (v.answers !== undefined) answers.set(criterion.id, v.answers);
    else problems.push(...v.problems.map((m) => `assisted ${criterion.id}: ${m}`));
  }
  for (const g of given) if (!assisted.some((a) => a.criterion.id === g.criterionId)) problems.push(`assisted: unexpected answer for ${g.criterionId}`);
  return { answers, problems };
}

/**
 * Deterministic post-check of a model result against the code's facts. Speech inside a recording pause is missing
 * from the transcript, so a result whose inspected range spans a pause cannot be "high" confidence.
 */
export function capConfidence(result: CriterionResult, facts: Pick<ReturnType<typeof deriveFacts>, 'recordingPausedRanges'>): CriterionResult {
  const range = result.checkedRange;
  if (result.confidence !== 'high' || !range) return result;
  return facts.recordingPausedRanges.some((p) => p.from <= range.to && p.to >= range.from) ? { ...result, confidence: 'medium' } : result;
}

export type ReuseLookup = (signature: string) => { result: CriterionResult; evaluationId: string } | undefined;

export type Plan = { decided: Map<string, CriterionResult>; assisted: AssistedItem[]; undecided: Criterion[] };

/**
 * Resolves each criterion without a model where it can: 1) its deterministic detector (if the checklist names
 * one), 2) an earlier result for the same conversation whose criterion has the same signature (so weight changes
 * and switched-off criteria never cost a model call). Whatever is left is `undecided` and goes to the model.
 */
export function planCriteria(conversation: Conversation, checklist: ChecklistVersion, reuse?: ReuseLookup): Plan {
  const facts = deriveFacts(conversation);
  const decided = new Map<string, CriterionResult>();
  const undecided: Criterion[] = [];
  const assisted: AssistedItem[] = [];
  for (const criterion of checklist.criteria) {
    // A retained detector name must never override edited instructions or N/A semantics.
    const canonical = originalCriterion(criterion);
    const supported = canonical !== undefined;
    const detectorName = supported ? criterion.detector : undefined;
    const detected = detectorName ? DETECTORS[detectorName]?.run({ conversation, facts, criterion }) : null;
    if (detected) {
      decided.set(criterion.id, detected);
      continue;
    }
    const prior = reuse?.(criterionSignature(criterion));
    if (prior) {
      decided.set(criterion.id, { ...structuredClone(prior.result), criterionId: criterion.id, reusedFrom: prior.evaluationId });
      continue;
    }
    const helper = (detectorName ? ASSISTED_DETECTORS[detectorName] : undefined) ?? (canonical ? ORIGINAL_SEMANTIC_HELPERS[canonical.id] : undefined);
    if (helper?.appliesTo(criterion)) assisted.push({ criterion, detector: helper });
    else undecided.push(criterion);
  }
  return { decided, assisted, undecided };
}

export type EvaluatorResult = {
  results: CriterionResult[];
  decisionFacts: DecisionFacts;
  total: number | null;
  seriousViolation: boolean;
  provenance: Provenance;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  latencyMs: number;
  /** Criteria the model decided or helped decide in this run (empty when rules and reuse covered everything). */
  modelCriteria: string[];
};

/**
 * Rules and reuse first; independent strict-schema slices (each with one repair attempt) for unresolved work.
 * The model cannot set `source`/`reusedFrom`: code stamps them. Totals are always computed by code.
 */
export async function evaluateConversation(provider: LlmProvider | undefined, conversation: Conversation, checklist: ChecklistVersion, reuse?: ReuseLookup, maxAttempts = 2): Promise<EvaluatorResult> {
  const { decided, assisted, undecided } = planCriteria(conversation, checklist, reuse);
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let latencyMs = 0;
  const started = performance.now();
  const modelResults = new Map<string, CriterionResult>();
  const decisionFacts: DecisionFacts = {};
  let provenance: Provenance = { provider: 'local', model: 'rules+reuse', promptVersion: 'n/a' };

  if (undecided.length > 0 || assisted.length > 0) {
    if (!provider) throw new EvaluationFailure(`a model is required for criteria: ${[...undecided, ...assisted.map((a) => a.criterion)].map((c) => c.id).join(', ')}`);
    // The combined strict grammar exceeds the provider's compilation budget. These two independent
    // slices were verified live; run them concurrently and keep the same transcript/model for both.
    const extended = assisted.filter(a => a.detector.name === 'consultation-facts' || a.detector.name === 'dialogue-facts');
    const basic = assisted.filter(a => !extended.includes(a));
    const groups = [{ criteria: undecided, assisted: basic }, { criteria: [], assisted: extended }].filter(g => g.criteria.length || g.assisted.length);
    const initialDecided = [...decided.values()];
    const completed = await Promise.allSettled(groups.map(async ({ criteria, assisted }) => {
      const subset = { id: checklist.id, criteria };
      const outputSchema = buildOutputSchema(criteria, assisted, conversation.language);
      const system = systemPromptFor([...criteria, ...assisted.map(a => a.criterion)]);
      let problems: string[] = [];
      let ok = false;
      for (let attempt = 1; attempt <= maxAttempts && !ok; attempt++) {
        const res = await provider.complete({ system, user: buildUserPayload(conversation, subset, initialDecided, assisted, problems), outputSchema });
        usage.inputTokens += res.usage?.inputTokens ?? 0;
        usage.outputTokens += res.usage?.outputTokens ?? 0;
        usage.cacheReadTokens += res.usage?.cacheReadTokens ?? 0;
        usage.cacheWriteTokens += res.usage?.cacheWriteTokens ?? 0;
          const v = validateModelOutput(res.output, conversation, { ...checklist, criteria });
        const a = validateAssisted(res.output, conversation, assisted);
        if (v.results && a.problems.length === 0) {
          for (const r of v.results) {
            const { reusedFrom: _drop, ...clean } = r;
            modelResults.set(r.criterionId, capConfidence({ ...clean, source: 'model' }, deriveFacts(conversation)));
          }
          const facts = deriveFacts(conversation);
          for (const { criterion, detector } of assisted) {
            const answers = a.answers.get(criterion.id);
            decisionFacts[criterion.id] = { kind: detector.name, facts: structuredClone(answers) };
            decided.set(criterion.id, capConfidence(detector.decide({ conversation, facts, criterion }, answers), facts));
          }
          ok = true;
        } else problems = [...v.problems, ...a.problems];
      }
      if (!ok) throw new EvaluationFailure(`model output failed validation: ${problems.slice(0, 5).join('; ')}`);
    }));
    const failed = completed.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;
    latencyMs = Math.round(performance.now() - started);
    provenance = { provider: provider.name, model: provider.model, promptVersion: PROMPT_VERSION, ...(provider.effort ? { effort: provider.effort } : {}), usage, latencyMs };
  }

  const results = checklist.criteria.map((c) => decided.get(c.id) ?? modelResults.get(c.id)!);
  const { total, seriousViolation } = scoreEvaluation(checklist, results);
  return { results, decisionFacts, total, seriousViolation, provenance, usage, latencyMs, modelCriteria: [...modelResults.keys(), ...assisted.map((x) => x.criterion.id)] };
}
