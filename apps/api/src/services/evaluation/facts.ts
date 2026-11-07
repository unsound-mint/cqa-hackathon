import type { Conversation, TranscriptMessage } from '@cqa/contracts';

/**
 * Deterministic transcript facts handed to the model as context. Computed by code from system events,
 * roles and timestamps, so the model never has to rediscover (or hallucinate) them. System-event phrasings
 * come from the organizer's RU/KZ/EN data; extend the pattern lists when a new phrasing appears.
 */

/** System events confirming identity verification. */
export const IDENTITY_VERIFIED_PATTERNS = [/личност\p{L}*\s+клиента\s+подтвержд\p{L}*/iu, /жеке\s+басы\s+расталды/iu, /identity\s+(?:was\s+|has\s+been\s+)?verified/iu];
/** System events showing the chat/call reached a human operator. */
const OPERATOR_JOIN_PATTERNS = [/эскалаци\p{L}*\s+на\s+оператора/iu, /чат\s+операторға\s+жіберілді/iu, /transferred\s+to\s+an?\s+agent/iu, /агент\s+присоединил\p{L}*/iu];
/** Hold / internal consultation: the client cannot hear the operator while it lasts. */
const HOLD_OPEN = [/клиент\s+находится\s+на\s+удержании/iu, /началась\s+консультация/iu];
const HOLD_CLOSE = [/клиент\s+больше\s+не\s+находится\s+на\s+удержании/iu, /агент\s+вышел\s+из\s+разговора/iu];
/** Recording/transcription suspended: speech inside the range is NOT in the transcript. */
const RECORDING_PAUSE = [/приостановлен/iu];
const RECORDING_RESUME = [/возобновлен/iu];
/** Anonymization placeholders such as "[Имя скрыто]". */
const REDACTION = /\[[^\]]*скрыт[^\]]*\]/iu;

export type IndexRange = { from: number; to: number };

const matches = (m: TranscriptMessage, pats: RegExp[]) => m.speaker === 'system' && pats.some((re) => re.test(m.text));

/** Seconds for "MM:SS" or an ISO timestamp (any fraction length); null if unparseable. */
export function toSeconds(ts: string): number | null {
  const mmss = /^(\d+):(\d{2})$/.exec(ts);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms / 1000;
}

/** Ranges opened and closed by system events; an unclosed range runs to the end of the transcript. */
function rangesBetween(t: TranscriptMessage[], open: RegExp[], close: RegExp[]): IndexRange[] {
  const out: IndexRange[] = [];
  let start: number | null = null;
  for (const m of t) {
    if (start === null && matches(m, open)) start = m.index;
    else if (start !== null && matches(m, close)) {
      out.push({ from: start, to: m.index });
      start = null;
    }
  }
  if (start !== null) out.push({ from: start, to: t.length - 1 });
  return out;
}

const inAny = (i: number, ranges: IndexRange[]) => ranges.some((r) => i > r.from && i < r.to);

export function deriveFacts(c: Conversation) {
  const t = c.transcript;
  const operators = t.filter((m) => m.speaker === 'operator');
  const holdRanges = rangesBetween(t, HOLD_OPEN, HOLD_CLOSE);
  const recordingPausedRanges = rangesBetween(t, RECORDING_PAUSE, RECORDING_RESUME);
  const operatorJoinIndex = t.find((m) => matches(m, OPERATOR_JOIN_PATTERNS))?.index ?? null;
  const firstOperatorIndex = operators[0]?.index ?? null;

  const secs = t.map((m) => toSeconds(m.timestamp));
  const gaps = t
    .slice(1)
    .map((m, k) => ({ fromIndex: k, toIndex: m.index, seconds: secs[m.index] !== null && secs[k] !== null ? Math.round((secs[m.index]! - secs[k]!) * 10) / 10 : null }))
    .filter((g): g is { fromIndex: number; toIndex: number; seconds: number } => g.seconds !== null && g.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5);

  const spoken = t.filter((m) => m.speaker === 'client' || m.speaker === 'operator');
  const words = spoken.map((m) => m.text.trim().split(/\s+/).filter(Boolean).length);

  return {
    channel: c.channel,
    messageCount: t.length,
    firstOperatorIndex,
    operatorMessageIndices: operators.map((m) => m.index),
    operatorJoinIndex,
    secondsFromOperatorJoinToFirstOperatorMessage:
      operatorJoinIndex !== null && firstOperatorIndex !== null && secs[operatorJoinIndex] !== null && secs[firstOperatorIndex] !== null
        ? Math.round((secs[firstOperatorIndex]! - secs[operatorJoinIndex]!) * 10) / 10
        : null,
    identityVerificationEvents: t.filter((m) => matches(m, IDENTITY_VERIFIED_PATTERNS)).map((m) => m.index),
    holdRanges,
    operatorMessagesDuringHold: operators.filter((m) => inAny(m.index, holdRanges)).map((m) => m.index),
    recordingPausedRanges,
    redactionPlaceholderIndices: t.filter((m) => REDACTION.test(m.text)).map((m) => m.index),
    largestGapsBetweenMessages: gaps,
    transcriptQuality: {
      source: c.channel === 'voice call' ? 'automatic speech recognition (expect errors, split sentences, possible speaker mislabels)' : 'typed chat',
      averageWordsPerClientOrOperatorMessage: words.length ? Math.round((words.reduce((a, b) => a + b, 0) / words.length) * 10) / 10 : 0,
      shareOfMessagesWithAtMost3Words: words.length ? Math.round((words.filter((w) => w <= 3).length / words.length) * 100) / 100 : 0,
    },
    systemMessages: t.filter((m) => m.speaker === 'system').map((m) => ({ index: m.index, text: m.text })),
  };
}
