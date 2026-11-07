import type { CriterionResult, Language } from '@cqa/contracts';
import { z } from 'zod';
import { IDENTITY_VERIFIED_PATTERNS } from '../facts.js';
import { isBooleanYesNo, type AssistedDetector } from './types.js';

const AnswersSchema = z.object({
  verificationRequired: z.boolean(),
  reason: z.string().min(1),
  firstProtectedDisclosure: z.object({ messageIndex: z.number().int().nonnegative(), quote: z.string().min(1) }).nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
});
type Answers = z.infer<typeof AnswersSchema>;

const EXPLAIN: Record<Language, { yes: (e: string) => string; noEvent: string; noLate: string; gap: string }> = {
  RU: {
    yes: (e) => `Правило: подтверждение личности («${e}») зафиксировано до раскрытия защищённых данных или действия.`,
    noEvent: 'Правило: проверка личности требовалась, но события подтверждения личности в диалоге нет.',
    noLate: 'Правило: событие подтверждения личности появилось только после раскрытия защищённых данных или действия.',
    gap: ' В записи есть паузы, возможно часть проверки не попала в транскрипт: нужна проверка человеком.',
  },
  KZ: {
    yes: (e) => `Ереже: жеке басты растау («${e}») қорғалған деректер ашылғанға дейін тіркелген.`,
    noEvent: 'Ереже: жеке басты тексеру қажет болды, бірақ диалогта растау оқиғасы жоқ.',
    noLate: 'Ереже: жеке басты растау оқиғасы қорғалған деректер ашылғаннан кейін ғана пайда болды.',
    gap: ' Жазбада үзілістер бар, тексерудің бір бөлігі транскрипттен түсіп қалуы мүмкін: адам тексеруі қажет.',
  },
  EN: {
    yes: (e) => `Rule: identity verification ("${e}") was confirmed before protected data was disclosed or the action was taken.`,
    noEvent: 'Rule: verification was required but the dialog has no identity-verified event.',
    noLate: 'Rule: the identity-verified event only appears after the protected disclosure or action.',
    gap: ' The recording was paused, so part of the check may be missing from the transcript: needs human review.',
  },
};

/**
 * Rubric 03. The model answers only the context-dependent part (is verification required, and which operator
 * message first discloses protected data or acts on the account). Timing and the verdict come from the
 * system's identity-verified events, never from the model. N/A when verification was not required.
 */
export const verificationDetector: AssistedDetector<Answers> = {
  name: 'verification',
  description: 'Code decides from identity-verified system events; the model only says whether verification was required and where protected data was first disclosed.',
  question:
    'Answer two things about the OPERATOR. 1) verificationRequired: did the client\'s request require verifying the client\'s identity, i.e. did the operator disclose protected account information or carry out a protected action on the account (not generic or public information, how-to guidance or tariffs)? 2) firstProtectedDisclosure: the FIRST operator message that disclosed such information or carried out such an action, with a verbatim quote, or null if none did. Do not decide the criterion value.',
  answersJsonSchema: {
    type: 'object',
    properties: {
      verificationRequired: { type: 'boolean' },
      reason: { type: 'string' },
      firstProtectedDisclosure: { type: ['object', 'null'], properties: { messageIndex: { type: 'integer' }, quote: { type: 'string' } }, required: ['messageIndex', 'quote'] },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
    required: ['verificationRequired', 'reason', 'firstProtectedDisclosure', 'confidence'],
  },

  // N/A must be expressible, otherwise "not required" has no valid result and the criterion goes to the model.
  appliesTo: (c) => isBooleanYesNo(c) && c.allowNA,

  validate({ conversation }, raw) {
    const parsed = AnswersSchema.safeParse(raw);
    if (!parsed.success) return { problems: [`answers: ${parsed.error.issues[0]?.path.join('.') || 'shape'}: ${parsed.error.issues[0]?.message}`] };
    const a = parsed.data;
    const problems: string[] = [];
    const d = a.firstProtectedDisclosure;
    if (d) {
      const m = conversation.transcript[d.messageIndex];
      if (!m) problems.push(`firstProtectedDisclosure index ${d.messageIndex} is outside the transcript`);
      else {
        if (m.speaker !== 'operator') problems.push(`firstProtectedDisclosure must be an operator message (message ${d.messageIndex} is ${m.speaker})`);
        if (!m.text.includes(d.quote)) problems.push(`firstProtectedDisclosure quote not found verbatim in message ${d.messageIndex}`);
      }
    }
    if (!a.verificationRequired && d) problems.push('verificationRequired=false contradicts a protected disclosure');
    return problems.length ? { problems } : { answers: a, problems: [] };
  },

  decide({ conversation, facts, criterion }, a) {
    const lang = conversation.language;
    const t = conversation.transcript;
    const last = t.length - 1;
    const base = { criterionId: criterion.id, isNA: false as const, source: 'hybrid' as const };

    if (!a.verificationRequired) {
      return { ...base, value: null, isNA: true, naReason: a.reason, explanation: a.reason, confidence: a.confidence, evidence: [], checkedRange: { from: 0, to: last } } satisfies CriterionResult;
    }

    const disclosureIdx = a.firstProtectedDisclosure?.messageIndex ?? null;
    const before = facts.identityVerificationEvents.filter((i) => disclosureIdx === null || i < disclosureIdx);
    const disclosureEvidence = a.firstProtectedDisclosure ? [{ messageIndex: a.firstProtectedDisclosure.messageIndex, quote: a.firstProtectedDisclosure.quote }] : [];
    const checkedRange = { from: 0, to: disclosureIdx ?? last };

    if (before.length > 0) {
      const ev = t[before[before.length - 1]!]!;
      const phrase = IDENTITY_VERIFIED_PATTERNS.map((re) => re.exec(ev.text)?.[0]).find(Boolean) ?? ev.text;
      return { ...base, value: true, explanation: EXPLAIN[lang].yes(phrase), confidence: a.confidence, evidence: [{ messageIndex: ev.index, quote: phrase.replace(/[.!]\s*$/, '') }, ...disclosureEvidence], checkedRange } satisfies CriterionResult;
    }

    const late = facts.identityVerificationEvents.length > 0;
    const gap = facts.recordingPausedRanges.length > 0;
    return {
      ...base,
      value: false,
      explanation: (late ? EXPLAIN[lang].noLate : EXPLAIN[lang].noEvent) + (gap ? EXPLAIN[lang].gap : ''),
      // Rubric: required but not confirmed in the transcript is No. A recording gap means a human should look.
      confidence: gap ? 'low' : a.confidence,
      evidence: disclosureEvidence,
      checkedRange,
    } satisfies CriterionResult;
  },
};
