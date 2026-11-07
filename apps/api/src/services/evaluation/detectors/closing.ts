import type { CriterionResult, Language } from '@cqa/contracts';
import { L, R, isBooleanYesNo, lastOperatorTurn, type Detector } from './types.js';

const GOODBYE: Record<Language, RegExp> = {
  RU: new RegExp(
    `${L}(?:до\\s+свидания|до\\s+встречи|прощайте|счастливо|удачи|берегите\\s+себя|всего\\s+(?:доброго|хорошего|наилучшего)|(?:хорошего|приятного|отличного|прекрасного)\\s+(?:дня|вечера|утра|настроения|выходного|выходных))${R}`,
    'iu',
  ),
  KZ: new RegExp(
    `${L}(?:сау\\s*бол\\p{L}*|қош\\s*бол\\p{L}*|аман\\s+бол\\p{L}*|көріскенше|сәттілік\\p{L}*|күніңіз\\s+(?:сәтті|жақсы|жарқын)|(?:сәтті|жақсы)\\s+күн|жақсы\\s+демал\\p{L}*)${R}`,
    'iu',
  ),
  EN: new RegExp(`${L}(?:good\\s*bye|bye|take\\s+care|see\\s+you|farewell|all\\s+the\\s+best|best\\s+wishes|good\\s+day|have\\s+a\\s+(?:nice|great|good|wonderful|lovely|pleasant)\\s+\\p{L}+)${R}`, 'iu'),
};

/**
 * Rubric 07 is an OR: any one wrap-up element in the operator's last turn is enough (confirmed by Denis, 2026-11-08).
 * Elements provable by phrase: an offer of further help, a farewell, or a courteous reply to thanks / "happy to help".
 * A "summary" is semantic and is left to the model.
 */
const OFFER: Record<Language, RegExp> = {
  RU: new RegExp(
    `${L}(?:обращайтесь|пишите|напишите\\s+нам|звоните|позвоните|будем\\s+рады\\s+помочь|(?:если|при)\\s+(?:у\\s+вас\\s+)?(?:появятся|возникнут|останутся|будут|остан\\p{L}+|возникн\\p{L}+)\\s+(?:ещ[её]\\s+)?(?:вопрос\\p{L}*|затруднени\\p{L}*)|(?:могу|можем)\\s+(?:ещ[её]\\s+)?(?:чем-?то\\s+)?помочь|чем\\s+(?:ещ[её]\\s+)?(?:могу|можем)\\s+помочь|ещ[её]\\s+(?:какие-?либо\\s+)?вопрос\\p{L}*|остались\\s+вопросы)`,
    'iu',
  ),
  KZ: new RegExp(
    `${L}(?:сұрағыңыз\\s+(?:болса|туындаса)|сұрақ\\p{L}*\\s+(?:болса|туындаса)|жазыңыз|хабарласыңыз|көмектесуге\\s+дайын\\p{L}*|басқа\\s+сұрақ|тағы\\s+(?:бір\\s+)?сұрақ|көмектесе\\s+аламын)`,
    'iu',
  ),
  EN: new RegExp(
    `${L}(?:if\\s+you\\s+(?:have|need|get|run\\s+into)\\s+(?:any\\s+)?(?:further\\s+|more\\s+|other\\s+)?(?:questions?|help|issues?)|feel\\s+free|reach\\s+out|contact\\s+us|let\\s+us\\s+know|anything\\s+else|write\\s+(?:to\\s+)?us)`,
    'iu',
  ),
};

const COURTESY: Record<Language, RegExp> = {
  RU: new RegExp(`${L}(?:пожалуйста|не\\s+за\\s+что|рад[аы]?\\s+(?:был[аи]?\\s+)?помочь|рад[аы]?,?\\s+что\\s+(?:смог\\p{L}*|помог\\p{L}*)|всегда\\s+рады|к\\s+вашим\\s+услугам)${R}`, 'iu'),
  KZ: new RegExp(`${L}(?:өтінемін|оқасы\\s+жоқ|көмектескеніме\\s+қуаныштымын|қуана\\s+көмектесем\\p{L}*|әрдайым\\s+қуаныштымыз)${R}`, 'iu'),
  EN: new RegExp(`${L}(?:you(?:'|’)?re\\s+welcome|you\\s+are\\s+welcome|no\\s+problem|no\\s+worries|my\\s+pleasure|(?:happy|glad|pleased)\\s+to\\s+help|glad\\s+(?:i\\s+could|that\\s+(?:helped|worked))|any\\s*time|not\\s+at\\s+all)${R}`, 'iu'),
};

const EXPLAIN_YES: Record<Language, (quotes: string) => string> = {
  RU: (q) => `Правило: в последней реплике оператора есть завершающая фраза («${q}»).`,
  KZ: (q) => `Ереже: оператордың соңғы жауабында қорытынды сөз («${q}») бар.`,
  EN: (q) => `Rule: the operator's last turn wraps up the conversation ("${q}").`,
};
export const closingDetector: Detector = {
  name: 'closing',
  description: 'Yes when the last operator turn offers further help, says goodbye, or courteously acknowledges the outcome (any one). Summaries and applicability are left to the model.',
  run({ conversation, criterion, facts }) {
    if (!isBooleanYesNo(criterion)) return null;
    const lang = conversation.language;
    const turn = lastOperatorTurn(conversation);

    // OR: one wrap-up element is enough. Collect every distinct match so the evidence shows what was found.
    const found: { index: number; text: string }[] = [];
    for (const m of turn) {
      if (facts.operatorMessagesDuringHold.includes(m.index)) continue;
      for (const re of [OFFER[lang], GOODBYE[lang], COURTESY[lang]]) {
        const x = re.exec(m.text);
        if (x && !found.some((f) => f.index === m.index && f.text === x[0])) found.push({ index: m.index, text: x[0] });
      }
    }
    if (found.length) {
      return {
        criterionId: criterion.id,
        value: true,
        isNA: false,
        explanation: EXPLAIN_YES[lang](found.map((f) => f.text).join(lang === 'EN' ? '" + "' : '» + «')),
        confidence: conversation.channel === 'voice call' ? 'medium' : 'high',
        source: 'rule',
        evidence: found.map((f) => ({ messageIndex: f.index, quote: f.text })),
        checkedRange: { from: turn[0]!.index, to: turn[turn.length - 1]!.index },
      };
    }

    // Disconnection establishes how the chat ended, not whether an earlier closing opportunity existed.
    // N/A therefore needs semantic assessment rather than an automatic exemption.
    return null;
  },
};
