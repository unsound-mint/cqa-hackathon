import type { Conversation, Criterion, TranscriptMessage } from '@cqa/contracts';
import { describe, expect, it } from 'vitest';
import { deriveFacts } from '../src/services/evaluation/facts.js';
import { DETECTORS } from '../src/services/evaluation/detectors/index.js';

const crit = (over: Partial<Criterion> = {}): Criterion => ({ id: 'c', title: 't', instructions: '', weight: 10, kind: 'boolean', allowedValues: [true, false], allowNA: true, ...over });
const chat = (language: Conversation['language'], rows: [TranscriptMessage['speaker'], string][]): Conversation => ({
  id: 'x', datasetGroupId: 'g', language, channel: 'agent chat', audioUrl: null,
  transcript: rows.map(([speaker, text], index) => ({ index, timestamp: '00:00', speaker, text })),
});
const run = (name: string, c: Conversation, criterion = crit()) => DETECTORS[name]!.run({ conversation: c, facts: deriveFacts(c), criterion });

describe('greeting-intro detector (proves Yes only)', () => {
  it.each([
    ['RU', 'Здравствуйте! Меня зовут Алина. Чем помочь?'],
    ['RU', 'Добрый день! Я Лера из поддержки.'],
    ['KZ', 'Сәлеметсіз бе! Мен Нұрланмын. Қандай сұрағыңыз бар?'],
    ['KZ', 'Сәлеметсіз бе, менің атым Аружан.'],
    ['EN', "Hello! I'm Maria from support."],
    ['EN', 'Good afternoon, my name is John.'],
    ['RU', 'Здравствуйте, меня зовут [Имя скрыто], чем могу помочь?'],
  ] as const)('%s: %s', (lang, text) => {
    const r = run('greeting-intro', chat(lang, [['client', 'q'], ['bot', 'b'], ['operator', text]]));
    expect(r).toMatchObject({ value: true, isNA: false, source: 'rule', confidence: 'high' });
    for (const e of r!.evidence) expect(text).toContain(e.quote!); // quotes are verbatim
  });

  it.each([
    ['RU', 'Привет, где именно ищете?'], // greeting, no introduction
    ['RU', 'Здравствуйте, я могу вам помочь.'], // "я могу" is not a name
    ['RU', 'Здравствуйте. Я Вам помогу.'], // polite pronoun is not a name
    ['KZ', 'Сәлем. Қай сайтқа кірдіңіз?'],
    ['KZ', 'Здравствуйте! Меня зовут Анна.'], // greeting in the wrong language for a KZ client
    ['EN', 'Open settings then log in again.'],
    ['EN', "Hi, I'm sorry for the delay."], // "I'm sorry" is not a name
  ] as const)('stays undecided (never a No): %s', (lang, text) => {
    expect(run('greeting-intro', chat(lang, [['client', 'q'], ['operator', text]]))).toBeNull();
  });

  it('joins the operator\'s first turn across messages and system events, but not past the client', () => {
    const split = chat('RU', [['client', 'q'], ['system', 'Оператор подключился'], ['operator', 'Здравствуйте!'], ['operator', 'Меня зовут Вера.']]);
    expect(run('greeting-intro', split)?.evidence.map((e) => e.messageIndex)).toEqual([2, 3]);
    const later = chat('RU', [['client', 'q'], ['operator', 'Здравствуйте!'], ['client', 'ok'], ['operator', 'Меня зовут Вера.']]);
    expect(run('greeting-intro', later)).toBeNull();
  });

  it('ignores a bot or client greeting and non-boolean criteria', () => {
    expect(run('greeting-intro', chat('RU', [['bot', 'Здравствуйте! Меня зовут Бот.'], ['operator', 'Что случилось?']]))).toBeNull();
    expect(run('greeting-intro', chat('RU', [['operator', 'Здравствуйте! Меня зовут Вера.']]), crit({ kind: 'discrete-scale', allowedValues: [0, 5] }))).toBeNull();
  });

  it('is medium confidence on recognized speech', () => {
    const call = { ...chat('RU', [['operator', 'Здравствуйте, меня зовут [Имя скрыто], чем могу помочь?']]), channel: 'voice call' as const };
    expect(run('greeting-intro', call)?.confidence).toBe('medium');
  });
});

describe('closing detector (proves Yes or N/A only)', () => {
  it.each([
    ['RU', 'Пожалуйста. Хорошего дня!'],
    ['RU', 'Если вопрос останется, напишите нам. До свидания!'],
    ['KZ', 'Рақмет. Сау болыңыз!'],
    ['KZ', 'Күніңіз сәтті болсын!'],
    ['EN', 'Glad to help. Have a great day!'],
    ['EN', 'Goodbye!'],
  ] as const)('%s: %s', (lang, text) => {
    const r = run('closing', chat(lang, [['client', 'q'], ['operator', 'ответ'], ['client', 'спасибо'], ['operator', text]]));
    expect(r).toMatchObject({ value: true, source: 'rule' });
    expect(text).toContain(r!.evidence[0]!.quote!);
  });

  it('a goodbye earlier in the chat does not count; only the last operator turn', () => {
    expect(run('closing', chat('RU', [['operator', 'До свидания'], ['client', 'стойте, еще вопрос'], ['operator', 'Слушаю вас']]))).toBeNull();
  });

  it('N/A only when the client side ended right after the client spoke last', () => {
    const left = chat('RU', [['client', 'q'], ['operator', 'Откройте раздел меню.'], ['client', 'не нашёл'], ['system', 'Клиент покинул чат.']]);
    expect(run('closing', left)).toMatchObject({ isNA: true, value: null, source: 'rule' });
    const operatorSpokeLast = chat('RU', [['client', 'q'], ['operator', 'Откройте раздел меню.'], ['system', 'Клиент покинул чат.']]);
    expect(run('closing', operatorSpokeLast)).toBeNull();
    const operatorClosed = chat('RU', [['client', 'q'], ['operator', 'ответ'], ['client', 'не понял'], ['system', 'Оператор закрыл чат.']]);
    expect(run('closing', operatorClosed)).toBeNull(); // operator ended it: opportunity existed, model decides
    expect(run('closing', left, crit({ allowNA: false }))).toBeNull(); // N/A not permitted for this criterion
  });
});
