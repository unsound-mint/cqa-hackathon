import type { Conversation, TranscriptMessage } from '@cqa/contracts';
import { describe, expect, it } from 'vitest';
import { deriveFacts, toSeconds } from '../src/services/evaluation/facts.js';

/** Wholly fictional call transcript shaped like recognized speech. */
function call(rows: [number, TranscriptMessage['speaker'], string][]): Conversation {
  const base = Date.UTC(2030, 0, 1, 10, 0, 0);
  return {
    id: 'fiction-call',
    datasetGroupId: 'fiction',
    language: 'RU',
    channel: 'voice call',
    audioUrl: null,
    transcript: rows.map(([sec, speaker, text], index) => ({ index, timestamp: new Date(base + sec * 1000).toISOString().replace('Z', '0000+00:00'), speaker, text })),
  };
}

const sample = call([
  [0, 'system', 'Запись и транскрибирование запущены.'],
  [2, 'bot', 'Добро пожаловать. Для выбора языка нажмите два.'],
  [9, 'client', '2'],
  [12, 'system', 'Клиент переведен от агента на представителя службы поддержки'],
  [14, 'system', 'Агент присоединился к разговору с клиентом.'],
  [31, 'operator', 'Здравствуйте, меня зовут [Имя скрыто], чем могу помочь?'],
  [40, 'client', 'Да я это подключить'],
  [44, 'system', 'Запись и транскрибирование приостановлены.'],
  [100, 'system', 'Запись и транскрибирование возобновлены.'],
  [101, 'system', 'Личность клиента подтверждена.'],
  [103, 'operator', 'Подождите на линии.'],
  [104, 'system', 'Клиент находится на удержании.'],
  [105, 'operator', 'Алло, коллега, клиент спрашивает про лимит.'],
  [150, 'operator', 'Так щас.'],
  [160, 'system', 'Клиент больше не находится на удержании.'],
  [162, 'operator', 'Спасибо что подождали.'],
]);

describe('toSeconds', () => {
  it('reads MM:SS and ISO timestamps with any fraction length', () => {
    expect(toSeconds('01:05')).toBe(65);
    expect(toSeconds('2030-01-01T10:00:01.1900670+00:00')! - toSeconds('2030-01-01T10:00:00.0000000+00:00')!).toBeCloseTo(1.19, 2);
    expect(toSeconds('garbage')).toBeNull();
  });
});

describe('deriveFacts', () => {
  const f = deriveFacts(sample);

  it('finds the human operator and the bot/IVR phase boundary', () => {
    expect(f.firstOperatorIndex).toBe(5);
    expect(f.operatorJoinIndex).toBe(4);
    expect(f.secondsFromOperatorJoinToFirstOperatorMessage).toBe(31 - 14);
  });

  it('marks hold ranges and the operator messages spoken to a colleague', () => {
    expect(f.holdRanges).toEqual([{ from: 11, to: 14 }]);
    expect(f.operatorMessagesDuringHold).toEqual([12, 13]);
  });

  it('marks recording pauses', () => {
    expect(f.recordingPausedRanges).toEqual([{ from: 7, to: 8 }]);
  });

  it('flags anonymization placeholders and verification events', () => {
    expect(f.redactionPlaceholderIndices).toEqual([5]);
    expect(f.identityVerificationEvents).toEqual([9]);
  });

  it('reports the largest gaps with real durations and voice quality stats', () => {
    expect(f.largestGapsBetweenMessages[0]).toEqual({ fromIndex: 7, toIndex: 8, seconds: 56 });
    expect(f.transcriptQuality.source).toMatch(/speech recognition/);
    expect(f.transcriptQuality.shareOfMessagesWithAtMost3Words).toBeGreaterThan(0.3);
  });

  it('an unclosed hold runs to the end; a chat is typed text with no ranges', () => {
    const open = deriveFacts(call([[0, 'operator', 'Минуту'], [1, 'system', 'Клиент находится на удержании.'], [5, 'operator', 'Коллега?']]));
    expect(open.holdRanges).toEqual([{ from: 1, to: 2 }]);
    const chat = deriveFacts({ ...sample, channel: 'agent chat', transcript: sample.transcript.map((m) => ({ ...m, timestamp: '00:00' })) });
    expect(chat.transcriptQuality.source).toBe('typed chat');
    expect(chat.largestGapsBetweenMessages).toEqual([]);
  });
});
