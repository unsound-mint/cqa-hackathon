import { z } from 'zod';
import type { AssistedDetector } from '../detectors/types.js';
import { Ref, common, commonJson, fullRange, refJson, object, list, parsed, referenceProblems, opRefs, clientRef, before, result, ruleText } from './common.js';

const Schema = z.strictObject({
  ...common, usedKnownContext: z.boolean(),
  missingDetails: z.array(z.strictObject({
    detail: z.string().trim().min(1), clientRequest: Ref, operatorQuestion: z.array(Ref).max(1), firstRelevantAnswer: z.array(Ref).max(1),
  })),
});
export type NeedsFacts = z.infer<typeof Schema>;
export const needsDetector: AssistedDetector<NeedsFacts> = {
  name: 'needs-facts', description: 'Extract necessary missing information; code applies N/A and question ordering.',
  appliesTo: () => true,
  question: `Extract facts, never a grade. missingDetails lists ONLY details genuinely necessary to answer the actual client request and absent when that request first reached the operator (use earlier client/bot context). No missing necessary information means an empty array, even if the operator asks an optional question. A new follow-up request is not proof that the initial request was incomplete. For each missing detail, cite the client request, the operator's question as a one-item operatorQuestion array ([] if never asked), and the FIRST relevant substantive operator answer as a one-item firstRelevantAnswer array ([] if not yet answered). usedKnownContext says whether the operator used rather than contradicted/re-requested already known details. Inspect the entire transcript and return a concise reason in responseLanguage.`,
  answersJsonSchema: object({ ...commonJson, fullRange, usedKnownContext: { type: 'boolean' }, missingDetails: list(object({ detail: { type: 'string' }, clientRequest: refJson, operatorQuestion: list(refJson), firstRelevantAnswer: list(refJson) })) }),
  validate(input, raw) {
    const p = parsed(Schema, raw); if (!p.answers) return p;
    const a = p.answers;
    const refs = [...a.missingDetails.flatMap(d => [clientRef(d.clientRequest), ...opRefs([...d.operatorQuestion, ...d.firstRelevantAnswer])])];
    const problems = referenceProblems(input, fullRange(input), refs);
    for (const d of a.missingDetails) {
      const question = d.operatorQuestion[0], answer = d.firstRelevantAnswer[0];
      if (question && answer && question.messageIndex === answer.messageIndex && !before(question, answer, input) && !before(answer, question, input)) problems.push('same-message question and answer quotes must isolate separate clauses for ordering');
      for (const r of [...d.operatorQuestion, ...d.firstRelevantAnswer]) if (r && !before(d.clientRequest, r, input)) problems.push('request must precede its operator question/answer');
    }

    return problems.length ? { problems } : { answers: a, problems: [] };
  },
  decide(input, a) {
    const value = !a.missingDetails.length ? null : a.usedKnownContext && a.missingDetails.every(d => d.operatorQuestion[0] !== undefined && (!d.firstRelevantAnswer[0] || before(d.operatorQuestion[0], d.firstRelevantAnswer[0], input)));
    return result(input, a, value, [...a.missingDetails.flatMap(d => [d.clientRequest, ...d.operatorQuestion, ...d.firstRelevantAnswer])], ruleText(input, 'Правило: N/A при достаточном исходном контексте; иначе проверяется уточнение до ответа.', 'Ереже: бастапқы дерек жеткілікті болса N/A; әйтпесе жауапқа дейін нақтылау тексеріледі.', 'Rule: sufficient initial context takes N/A precedence; otherwise clarification must precede the answer.'));
  },
};
