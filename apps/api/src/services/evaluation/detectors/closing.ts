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
 * PROVISIONAL policy (Denis, 2026-11-07): a goodbye in the last operator turn counts as the closing; the
 * rubric's "summarizes or offers further help AND says goodbye" is ambiguous and DEV closings are mostly a
 * bare goodbye. Flip to true to also require an offer/summary (then this detector only proves via the model path).
 */
export const REQUIRE_OFFER_OR_SUMMARY = false;

const EXPLAIN_YES: Record<Language, (q: string) => string> = {
  RU: (q) => `Правило: в последней реплике оператора есть прощание («${q}»).`,
  KZ: (q) => `Ереже: оператордың соңғы жауабында қоштасу («${q}») бар.`,
  EN: (q) => `Rule: the operator's last turn contains a goodbye ("${q}").`,
};
const EXPLAIN_NA: Record<Language, string> = {
  RU: 'Правило: диалог оборвался на стороне клиента сразу после его последнего сообщения, возможности завершить разговор не было.',
  KZ: 'Ереже: диалог клиент жағынан оның соңғы хабарламасынан кейін үзілді, аяқтауға мүмкіндік болмады.',
  EN: "Rule: the dialog ended on the client's side right after the client's last message, so there was no opportunity to close.",
};

export const closingDetector: Detector = {
  name: 'closing',
  description: 'Yes when the last operator turn has a goodbye (provisional policy); N/A when the client side ended the dialog right after speaking. Never decides No.',
  run({ conversation, criterion }) {
    if (!isBooleanYesNo(criterion) || REQUIRE_OFFER_OR_SUMMARY) return null;
    const lang = conversation.language;
    const t = conversation.transcript;
    const turn = lastOperatorTurn(conversation);

    for (const m of [...turn].reverse()) {
      const g = GOODBYE[lang].exec(m.text);
      if (g) {
        return {
          criterionId: criterion.id,
          value: true,
          isNA: false,
          explanation: EXPLAIN_YES[lang](g[0]),
          confidence: conversation.channel === 'voice call' ? 'medium' : 'high',
          source: 'rule',
          evidence: [{ messageIndex: m.index, quote: g[0] }],
          checkedRange: { from: turn[0]!.index, to: turn[turn.length - 1]!.index },
        };
      }
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
