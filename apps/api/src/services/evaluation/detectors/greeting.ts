import type { CriterionResult, EvidenceReference, Language } from '@cqa/contracts';
import { L, R, firstOperatorTurn, isBooleanYesNo, type Detector } from './types.js';

/** A greeting is only proof when it is in the CLIENT's language (rubric 01). */
const GREETING: Record<Language, RegExp> = {
  RU: new RegExp(`${L}(?:здравствуй(?:те)?|добр(?:ый|ое|ого)\\s+(?:день|вечер|утро|времени\\s+суток)|приветствую|привет)${R}`, 'iu'),
  KZ: new RegExp(`${L}(?:сәлеметсіз\\s*бе|сәлеметсіздер\\s*ме|сәлем|амансыз\\s*ба|армысыз|қайырлы\\s+(?:таң|күн|кеш|түн))${R}`, 'iu'),
  EN: new RegExp(`${L}(?:hello|hi|hey|good\\s+(?:morning|afternoon|evening|day)|greetings)${R}`, 'iu'),
};

const NOT_NAMES = new Set(['вам', 'вас', 'вами', 'ваш', 'ваша', 'ваше', 'ваши', 'мы', 'мне', 'мой', 'моя', 'мое', 'моё']);
const NAME = '(\\p{L}[\\p{L}\\-]+)';
const REDACTED_NAME = /\[Имя скрыто\]/iu;

const INTRO: Record<Language, RegExp[]> = {
  RU: [new RegExp(`${L}(?:меня\\s+зовут|моё\\s+имя|мое\\s+имя|на\\s+связи|вас\\s+приветствует)${R}`, 'iu'), new RegExp(`${L}я\\s+${NAME}`, 'iu')],
  KZ: [new RegExp(`${L}(?:менің\\s+атым|менiң\\s+атым)${R}`, 'iu'), new RegExp(`${L}мен\\s+${NAME}`, 'iu')],
  EN: [new RegExp(`${L}(?:my\\s+name\\s+is)${R}`, 'iu'), new RegExp(`${L}(?:i['’]m|i\\s+am|this\\s+is)\\s+${NAME}`, 'iu')],
};

/** "я Тимур" is an introduction; "я могу" / "Я Вам" are not: the word after the pronoun must be a capitalised name. */
function isCapitalisedName(word: string | undefined): boolean {
  if (!word) return false;
  const first = word[0]!;
  return first === first.toUpperCase() && first !== first.toLowerCase() && !NOT_NAMES.has(word.toLowerCase());
}

function findIntro(text: string, lang: Language): string | null {
  if (REDACTED_NAME.test(text)) return REDACTED_NAME.exec(text)![0];
  for (const re of INTRO[lang]) {
    const m = re.exec(text);
    if (!m) continue;
    if (m[1] === undefined || isCapitalisedName(m[1])) return m[0];
  }
  return null;
}

const EXPLAIN: Record<Language, (g: string, i: string) => string> = {
  RU: (g, i) => `Правило: в первом ответе оператора есть приветствие на языке клиента («${g}») и представление («${i}»).`,
  KZ: (g, i) => `Ереже: оператордың алғашқы жауабында клиент тілінде сәлемдесу («${g}») және таныстыру («${i}») бар.`,
  EN: (g, i) => `Rule: the operator's first reply has a greeting in the client's language ("${g}") and an introduction ("${i}").`,
};

export const greetingIntroDetector: Detector = {
  name: 'greeting-intro',
  description: "Yes when the operator's first turn contains a greeting in the client's language and a self-introduction. Never decides No.",
  run({ conversation, criterion }) {
    if (!isBooleanYesNo(criterion)) return null;
    const lang = conversation.language;
    const turn = firstOperatorTurn(conversation);
    let greeting: { index: number; text: string } | undefined;
    let intro: { index: number; text: string } | undefined;
    for (const m of turn) {
      const g = GREETING[lang].exec(m.text);
      if (g && !greeting) greeting = { index: m.index, text: g[0] };
      const i = findIntro(m.text, lang);
      if (i && !intro) intro = { index: m.index, text: i };
    }
    if (!greeting || !intro) return null;
    const evidence: EvidenceReference[] = [{ messageIndex: greeting.index, quote: greeting.text }];
    if (intro.index !== greeting.index || intro.text !== greeting.text) evidence.push({ messageIndex: intro.index, quote: intro.text });
    const result: CriterionResult = {
      criterionId: criterion.id,
      value: true,
      isNA: false,
      explanation: EXPLAIN[lang](greeting.text, intro.text),
      confidence: conversation.channel === 'voice call' ? 'medium' : 'high',
      source: 'rule',
      evidence,
      checkedRange: { from: turn[0]!.index, to: turn[turn.length - 1]!.index },
    };
    return result;
  },
};
