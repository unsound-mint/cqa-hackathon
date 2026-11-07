import { z } from 'zod';
import type { AssistedDetector } from '../detectors/types.js';
import { Ref, common, commonJson, fullRange, refJson, object, list, parsed, referenceProblems, opRefs, clientRef, before, result, ruleText } from './common.js';

const Schema = z.strictObject({
  ...common, usedKnownContext: z.boolean(),
  missingDetails: z.array(z.strictObject({
    detail: z.string().trim().min(1), clientRequest: Ref, operatorQuestion: z.array(Ref).max(1), firstAdviceDependingOnDetail: z.array(Ref).max(1),
  })),
});
export type NeedsFacts = z.infer<typeof Schema>;
export const needsDetector: AssistedDetector<NeedsFacts> = {
  name: 'needs-facts', description: 'Extract necessary missing information; code applies N/A and question ordering.',
  appliesTo: () => true,
  question: `Extract facts, never a grade. Inspect the entire transcript and write reason/detail in responseLanguage.
- missingDetails lists information the OPERATOR needed FROM THE CLIENT when the request first reached them, using earlier client/bot context. A requested button name, menu path or policy is consultation OUTPUT, never a missing intake detail by itself.
- Judge sufficiency for the requested answer. For public navigation/how-to, do not require a currency, period or current website if the same correct public path/address can be given without that value. Telling clients to select their own currency/dates does not require learning those values first. No necessary missing detail means [], even if an optional question was asked.
- For diagnosis/investigation, genuinely necessary details do not become optional merely because a generic next step was given or the client deferred the investigation. A detail supplied or ruled out AFTER an operator question was missing initially; later replies are not initial context. A new follow-up request alone does not prove the original request lacked information.
- If the client only asked to reach a human to explain a problem, the problem's nature is still missing. The operator asking how to help elicits it; completing the handoff alone does not justify N/A.
- If similar search results or an uncertain name prevent finding the intended item, asking whether the client has/uses an exact identifier clarifies necessary search context. They need not dictate the identifier; distinguishing name-based search from exact-identifier search can be the missing detail.
- Each missing detail needs: detail (what client information was needed), clientRequest (exact source quote), operatorQuestion (one-item array with the OPERATOR question, or [] if never asked), firstAdviceDependingOnDetail (one-item array with the FIRST OPERATOR advice whose correctness depends on this particular detail, or [] if none yet). Never cite the client's answer as operator advice. Greetings, identity-verification instructions, acknowledgements, collecting other information and opening an investigation do NOT count as advice depending on that missing detail.
- usedKnownContext: did the operator use rather than contradict or re-request already known details?`,
  answersJsonSchema: object({ ...commonJson, usedKnownContext: { type: 'boolean' }, missingDetails: list(object({ detail: { type: 'string' }, clientRequest: refJson, operatorQuestion: list(refJson), firstAdviceDependingOnDetail: list(refJson) })) }),
  validate(input, raw) {
    const p = parsed(Schema, raw); if (!p.answers) return p;
    const a = p.answers;
    const refs = [...a.missingDetails.flatMap(d => [clientRef(d.clientRequest), ...opRefs([...d.operatorQuestion, ...d.firstAdviceDependingOnDetail])])];
    const problems = referenceProblems(input, fullRange(input), refs);
    for (const d of a.missingDetails) {
      const question = d.operatorQuestion[0], answer = d.firstAdviceDependingOnDetail[0];
      if (question && answer && question.messageIndex === answer.messageIndex && !before(question, answer, input) && !before(answer, question, input)) problems.push('same-message question and answer quotes must isolate separate clauses for ordering');
      for (const r of [...d.operatorQuestion, ...d.firstAdviceDependingOnDetail]) if (r && !before(d.clientRequest, r, input)) problems.push('request must precede its operator question/answer');
    }

    return problems.length ? { problems } : { answers: a, problems: [] };
  },
  decide(input, a) {
    const value = !a.missingDetails.length ? null : a.usedKnownContext && a.missingDetails.every(d => d.operatorQuestion[0] !== undefined && (!d.firstAdviceDependingOnDetail[0] || before(d.operatorQuestion[0], d.firstAdviceDependingOnDetail[0], input)));
    return result(input, a, value, [...a.missingDetails.flatMap(d => [d.clientRequest, ...d.operatorQuestion, ...d.firstAdviceDependingOnDetail])], ruleText(input, 'Правило: N/A при достаточном исходном контексте; иначе проверяется уточнение до ответа.', 'Ереже: бастапқы дерек жеткілікті болса N/A; әйтпесе жауапқа дейін нақтылау тексеріледі.', 'Rule: sufficient initial context takes N/A precedence; otherwise clarification must precede the answer.'));
  },
};
