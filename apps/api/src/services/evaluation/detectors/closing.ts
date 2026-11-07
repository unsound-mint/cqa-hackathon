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

/** System events that mean the CLIENT side ended the dialog (not the operator closing it). */
const CLIENT_SIDE_END = [/клиент\s+(?:покинул|завершил)/iu, /соединение\s+с\s+клиентом\s+прервано/iu, /клиентпен\s+байланыс\s+үзілді/iu, /connection\s+to\s+(?:the\s+)?customer\s+(?:was\s+)?lost/iu, /customer\s+(?:left|disconnected)/iu];

/**
 * An offer of further help, the second half of rubric 07 ("summarizes OR offers further help, AND says goodbye").
 * A "summary" is semantic and is left to the model; only the offer is provable by phrase.
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
    `${L}(?:if\\s+you\\s+(?:have|need|get|run\\s+into)\\s+(?:any\\s+)?(?:further\\s+|more\\s+|other\\s+)?(?:questions?|help|issues?)|feel\\s+free|reach\\s+out|contact\\s+us|let\\s+us\\s+know|anything\\s+else|happy\\s+to\\s+help|write\\s+(?:to\\s+)?us|here\\s+to\\s+help)`,
    'iu',
  ),
};

const EXPLAIN_YES: Record<Language, (offer: string, bye: string) => string> = {
  RU: (o, b) => `Правило: в последней реплике оператора есть предложение помощи («${o}») и прощание («${b}»).`,
  KZ: (o, b) => `Ереже: оператордың соңғы жауабында көмек ұсынысы («${o}») және қоштасу («${b}») бар.`,
  EN: (o, b) => `Rule: the operator's last turn offers further help ("${o}") and says goodbye ("${b}").`,
};
const EXPLAIN_NA: Record<Language, string> = {
  RU: 'Правило: диалог оборвался на стороне клиента сразу после его последнего сообщения, возможности завершить разговор не было.',
  KZ: 'Ереже: диалог клиент жағынан оның соңғы хабарламасынан кейін үзілді, аяқтауға мүмкіндік болмады.',
  EN: "Rule: the dialog ended on the client's side right after the client's last message, so there was no opportunity to close.",
};

export const closingDetector: Detector = {
  name: 'closing',
  description: 'Yes when the last operator turn offers further help AND says goodbye (strict); N/A when the client side ended the dialog right after speaking. A bare goodbye is left to the model. Never decides No.',
  run({ conversation, criterion }) {
    if (!isBooleanYesNo(criterion)) return null;
    const lang = conversation.language;
    const t = conversation.transcript;
    const turn = lastOperatorTurn(conversation);

    // Strict "AND": an offer of help and a goodbye, both in the last operator turn. A bare goodbye proves nothing.
    let bye: { index: number; text: string } | undefined;
    let offer: { index: number; text: string } | undefined;
    for (const m of turn) {
      const g = GOODBYE[lang].exec(m.text);
      if (g) bye = { index: m.index, text: g[0] };
      const o = OFFER[lang].exec(m.text);
      if (o && !offer) offer = { index: m.index, text: o[0] };
    }
    if (bye && offer) {
      return {
        criterionId: criterion.id,
        value: true,
        isNA: false,
        explanation: EXPLAIN_YES[lang](offer.text, bye.text),
        confidence: conversation.channel === 'voice call' ? 'medium' : 'high',
        source: 'rule',
        evidence: [
          { messageIndex: offer.index, quote: offer.text },
          { messageIndex: bye.index, quote: bye.text },
        ],
        checkedRange: { from: turn[0]!.index, to: turn[turn.length - 1]!.index },
      };
    }

    // N/A proof: the final non-system message is the client's and the transcript ends with a client-side departure event.
    if (criterion.allowNA) {
      const lastReal = [...t].reverse().find((m) => m.speaker !== 'system');
      const tail = t.slice((lastReal?.index ?? -1) + 1);
      const clientSideEnd = tail.find((m) => m.speaker === 'system' && CLIENT_SIDE_END.some((re) => re.test(m.text)));
      if (lastReal?.speaker === 'client' && clientSideEnd) {
        return {
          criterionId: criterion.id,
          value: null,
          isNA: true,
          naReason: EXPLAIN_NA[lang],
          explanation: EXPLAIN_NA[lang],
          confidence: 'medium',
          source: 'rule',
          evidence: [{ messageIndex: lastReal.index }, { messageIndex: clientSideEnd.index }],
          checkedRange: { from: lastReal.index, to: t.length - 1 },
        };
      }
    }
    return null;
  },
};
