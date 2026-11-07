import { z } from 'zod';
import type { AssistedDetector } from '../detectors/types.js';
import { Ref, common, commonJson, fullRange, indexJson, object, list, choice, parsed, referenceProblems, opRefs, clientRef, before, result, ruleText } from './common.js';
const Schema = z.strictObject({
  ...common, requestFormulated: z.boolean(),
  requests: z.array(z.strictObject({
    description: z.string().trim().min(1), clientRequest: Ref, materiality: z.enum(['main', 'material', 'minor']),
    handling: z.enum(['answered', 'concrete_next_step', 'generic_hint', 'unanswered']), operatorEvidence: z.array(Ref),
  })),
  incorrectKeyRecommendation: z.array(Ref).max(1),
});
export type ConsultationFacts = z.infer<typeof Schema>;
export const consultationDetector: AssistedDetector<ConsultationFacts> = {
  name: 'consultation-facts', description: 'Extract actual requests and how they were handled; code chooses the exact consultation tier.',
  appliesTo: () => true,
  question: `All evidence references in these answers are original integer message indices, not quote objects. Code will copy the exact original message text for evidence. Extract facts, never a grade. First set requestFormulated to whether the client formulated a substantive consultation need. A routing-only request to reach a human, greetings, or saying they will explain later is not yet a substantive consultation request. If the client leaves before explaining the problem, requestFormulated=false and requests=[] even if the operator connected and asked how to help. List ALL actually expressed client requests, including each distinct material question and any explicitly requested minor detail. A problem report or statement of inability to perform an action is a request for assistance even without a question mark. Cite the relevant client wording; split multiple questions even if in one message. Never invent an unasked requirement such as an ETA. Combine restatements/re-asks of the same question into one request anchored at its original formulation. requestFormulated=true requires a non-empty requests array; false requires an empty array. An empty requests array means the chat ended before any request was formulated. Classify each request as main/material/minor and its handling: answered, concrete_next_step (correct appropriate actionable client OR operator/team step, including investigation/escalation with a return path), generic_hint (too vague to know how to act), or unanswered. A pending underlying process is compatible with a concrete_next_step; final resolution and an unasked ETA are not required. Explain each request in description and cite client-facing operator evidence for any handling except unanswered. incorrectKeyRecommendation identifies an incorrect FINAL operative key recommendation, as a one-item array, or [] if none. An initial wrong route that was explicitly corrected is a dialogue-management issue, not automatically a final incorrect key recommendation. Inspect the entire transcript. Use responseLanguage for descriptions/reason.`,
  answersJsonSchema: object({ ...commonJson, requestFormulated: { type: 'boolean' }, requests: list(object({ description: { type: 'string' }, clientRequest: indexJson, materiality: choice('main', 'material', 'minor'), handling: choice('answered', 'concrete_next_step', 'generic_hint', 'unanswered'), operatorEvidence: list(indexJson) })), incorrectKeyRecommendation: list(indexJson) }),
  validate(input, raw) {
    const p = parsed(Schema, raw, input); if (!p.answers) return p;
    const a = p.answers;
    const problems = referenceProblems(input, fullRange(input), [...opRefs(a.incorrectKeyRecommendation), ...a.requests.flatMap(r => [clientRef(r.clientRequest), ...opRefs(r.operatorEvidence)])]);
    if (a.requestFormulated !== (a.requests.length > 0)) problems.push('requestFormulated must agree with the non-empty requests list');
    if (a.requests.length && !a.requests.some(r => r.materiality !== 'minor')) problems.push('a formulated request must include a main/material question');
    if (!a.requests.length && a.incorrectKeyRecommendation.length) problems.push('incorrect key recommendation requires a formulated request');
    for (const r of a.requests) {
      if (r.handling !== 'unanswered' && !r.operatorEvidence.length) problems.push('non-absent request handling requires operator evidence');
      if (r.handling === 'unanswered' && r.operatorEvidence.length) problems.push('unanswered request must not claim handling evidence');
      for (const e of r.operatorEvidence) if (!before(r.clientRequest, e, input)) problems.push('request must precede handling evidence');
    }
    return problems.length ? { problems } : { answers: a, problems: [] };
  },
  decide(input, a) {
    const covered = (r: ConsultationFacts['requests'][number]) => r.handling === 'answered' || r.handling === 'concrete_next_step';
    const material = a.requests.filter(r => r.materiality !== 'minor');
    const value = !a.requestFormulated ? null : a.incorrectKeyRecommendation.length ? 0
      : material.every(covered) ? (a.requests.every(covered) ? 20 : 15)
      : a.requests.some(covered) ? 10 : a.requests.some(r => r.handling === 'generic_hint') ? 5 : 0;
    return result(input, a, value, [...a.requests.flatMap(r => [r.clientRequest, ...r.operatorEvidence]), ...a.incorrectKeyRecommendation], ruleText(input, 'Правило: балл определён по покрытию заявленных вопросов и корректному следующему шагу.', 'Ереже: балл қойылған сұрақтардың қамтылуына және дұрыс келесі қадамға сәйкес есептелді.', 'Rule: the tier follows coverage of expressed requests and appropriate concrete next steps.'));
  },
};
