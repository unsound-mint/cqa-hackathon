import { z } from 'zod';
import type { AssistedDetector } from '../detectors/types.js';
import { Ref, common, commonJson, fullRange, indexJson, object, list, choice, parsed, referenceProblems, opRefs, clientRef, before, result, ruleText } from './common.js';
const Schema = z.strictObject({
  ...common, operatorEvidence: z.array(Ref),
  incoherencePreventingUnderstanding: z.array(z.strictObject({ operatorEvidence: z.array(Ref).min(1), clientReaction: z.array(Ref).max(1), reason: z.string().trim().min(1) })).max(1),
  forcedClarifications: z.array(z.strictObject({ operatorWording: Ref, clientReask: Ref, reason: z.string().trim().min(1) })),
  otherCommunicationFlaws: z.array(z.strictObject({ operatorWording: Ref, reason: z.string().trim().min(1) })),
  waits: z.array(z.strictObject({ start: Ref, kind: z.enum(['hold_event', 'operator_check_announced', 'client_wait_complaint']), advanceWarning: z.array(Ref).max(1) })),
});
export type DialogueFacts = z.infer<typeof Schema>;
export const dialogueDetector: AssistedDetector<DialogueFacts> = {
  name: 'dialogue-facts', description: 'Extract causal communication failures and explicit waits; code applies severity precedence.',
  appliesTo: () => true,
  question: `All evidence references in these answers are original integer message indices, not quote objects. Code will copy the exact original message text for evidence. Extract facts about wording/order/understanding, never a grade. incoherencePreventingUnderstanding is [] unless incoherent or contradictory operator speech prevents understanding (give a one-item array with operatorEvidence, clientReaction as a one-item array or [], and reason). For automatic speech recognition, garbled fragments alone do not prove operator incoherence: require a client reaction showing confusion. forcedClarifications lists each actual client re-ask CAUSED by the cited operator's unclear, wrong-navigation, disordered or contradictory instructions. Later successful correction does not erase it. A normal new question, request for more content, or refusal of a clearly worded improper offer is NOT a forced clarification. otherCommunicationFlaws lists notable clarity/order flaws that did not force a client re-ask. Missing consultation content, absent empathy and clear unethical offers do not by themselves belong here. waits lists EXPLICIT waits only: a system hold event, operator-announced check, or client complaint about waiting. Numerical time gaps alone do not establish a wait; do not assess the first-response SLA or invent a threshold. advanceWarning is a one-item array citing the operator warning at/before that wait, or [] if none. An operator's 'I will check the route' is itself an advance warning without any ETA, so cite it as both start and warning. Use derivedFacts.holdRanges to include actual holds; never credit internal speech during them. operatorEvidence cites representative client-facing wording even when clear; inspect the entire transcript. Write reasons in responseLanguage.`,
  answersJsonSchema: object({
    ...commonJson, operatorEvidence: list(indexJson),
    incoherencePreventingUnderstanding: list(object({ operatorEvidence: list(indexJson), clientReaction: list(indexJson), reason: { type: 'string' } })),
    forcedClarifications: list(object({ operatorWording: indexJson, clientReask: indexJson, reason: { type: 'string' } })),
    otherCommunicationFlaws: list(object({ operatorWording: indexJson, reason: { type: 'string' } })),
    waits: list(object({ start: indexJson, kind: choice('hold_event', 'operator_check_announced', 'client_wait_complaint'), advanceWarning: list(indexJson) })),
  }),
  validate(input, raw) {
    const p = parsed(Schema, raw, input); if (!p.answers) return p;
    const a = p.answers; const incoherent = a.incoherencePreventingUnderstanding[0];
    const refs = [...opRefs([...a.operatorEvidence, ...(incoherent?.operatorEvidence ?? []), ...a.forcedClarifications.map(f => f.operatorWording), ...a.otherCommunicationFlaws.map(f => f.operatorWording)]),
      ...a.forcedClarifications.map(f => clientRef(f.clientReask)), ...(incoherent?.clientReaction.map(clientRef) ?? []),
      ...a.waits.flatMap(w => [{ ref: w.start, role: w.kind === 'hold_event' ? 'system' as const : w.kind === 'client_wait_complaint' ? 'client' as const : 'operator' as const }, ...opRefs(w.advanceWarning)])];
    const problems = referenceProblems(input, fullRange(input), refs);
    for (const f of a.forcedClarifications) if (!before(f.operatorWording, f.clientReask, input)) problems.push('forced clarification must follow the causal operator wording');
    if (incoherent?.clientReaction[0] && !incoherent.operatorEvidence.some(e => before(e, incoherent.clientReaction[0]!, input))) problems.push('client reaction must follow incoherent operator speech');
    if (input.conversation.channel === 'voice call' && incoherent && !incoherent.clientReaction.length) problems.push('voice incoherence requires a client reaction, not ASR fragments alone');
    for (const w of a.waits) {
      if (input.facts.firstOperatorIndex === null || w.start.messageIndex < input.facts.firstOperatorIndex) problems.push('wait must concern the operator exchange, not time before the operator joined');
      if (w.kind === 'hold_event' && !input.facts.holdRanges.some(r => r.from === w.start.messageIndex)) problems.push('hold_event must cite an actual derived hold start');
      if (w.kind === 'operator_check_announced' && !w.advanceWarning.length) problems.push('an announced check is itself an advance warning');
      const warning = w.advanceWarning[0];
      if (warning && !(warning.messageIndex === w.start.messageIndex && warning.quote === w.start.quote) && !before(warning, w.start, input)) problems.push('advance warning must be at or before the wait');
    }
    for (const hold of input.facts.holdRanges) if (!a.waits.some(w => w.kind === 'hold_event' && w.start.messageIndex === hold.from)) problems.push(`missing actual hold at message ${hold.from}`);
    if (!incoherent && !a.operatorEvidence.length) problems.push('dialogue assessment requires representative client-facing operator evidence');
    return problems.length ? { problems } : { answers: a, problems: [] };
  },
  decide(input, a) {
    const value = a.incoherencePreventingUnderstanding.length ? 0 : a.forcedClarifications.length ? 4
      : a.otherCommunicationFlaws.length || a.waits.some(w => !w.advanceWarning.length) ? 7 : 10;
    return result(input, a, value, [...a.operatorEvidence, ...(a.incoherencePreventingUnderstanding[0]?.operatorEvidence ?? []), ...(a.incoherencePreventingUnderstanding[0]?.clientReaction ?? []), ...a.forcedClarifications.flatMap(f => [f.operatorWording, f.clientReask]), ...a.otherCommunicationFlaws.map(f => f.operatorWording), ...a.waits.flatMap(w => [w.start, ...w.advanceWarning])], ruleText(input, 'Правило: приоритет — непонимание, вынужденный переспрос, прочий сбой или ожидание без предупреждения, затем ясный диалог.', 'Ереже: алдымен түсініксіздік, мәжбүрлі қайта сұрау, өзге ақау немесе ескертусіз күту, содан кейін анық диалог бағаланады.', 'Rule: severity precedence is incomprehension, forced re-ask, other flaw/unannounced wait, then clear dialogue.'));
  },
};
