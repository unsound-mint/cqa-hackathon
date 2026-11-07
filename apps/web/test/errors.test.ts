import { describe, expect, it } from 'vitest';
import { CqaApiError } from '../src/api/CqaApi';
import { humanError } from '../src/lib/errors';

/**
 * Every message the API, the scorer, the model runner and the two clients can surface (apps/api, packages/contracts
 * scoring, MockCqaApi, HttpCqaApi). Each must get its own Russian text, not the generic fallback: if a server message
 * is reworded, this fails instead of English reaching a reviewer.
 */
const KNOWN: [string, RegExp][] = [
  ['this criterion has a pending appeal: decide the appeal instead', /апелляция на рассмотрении/],
  ['a pending appeal already exists for this criterion', /уже подана апелляция/],
  ['appeal is already upheld', /уже принято решение/],
  ['appeal appeal-mock-3 is already overridden', /уже принято решение/],
  ['only a completed evaluation can be appealed', /ещё не завершена/],
  ['only a completed evaluation can be changed', /ещё не завершена/],
  ['criterion is not part of this evaluation', /нет в оценке/],
  ['criterion 09 is not part of this evaluation', /нет в оценке/],
  ['value 7 is not allowed for criterion 04', /не допускается/],
  ['N/A is not allowed for criterion 01', /не допускается/],
  ['missing result for criterion 03', /не совпадает с чек-листом/],
  ['duplicate result for 03', /не совпадает с чек-листом/],
  ['result for unknown criterion 99', /не совпадает с чек-листом/],
  ['criterion 04: non-N/A result needs a value', /не совпадает с чек-листом/],
  ['criterion 09: enum criteria cannot carry weight', /не совпадает с чек-листом/],
  ['no model provider configured (set ANTHROPIC_API_KEY); 3 conversation(s) have criteria that need a model', /ключ API.*: 3\./],
  ['provider request failed (status 429)', /лимит запросов/],
  ['provider request failed (status 503)', /код 503/],
  ['model returned no tool call', /не в том формате/],
  ['model output failed validation: 04: quote not found in message 7', /не прошёл проверку/],
  ['a model is required for criteria: 04, 05', /Для критериев 04, 05 нужна модель/],
  ['The operation was aborted due to timeout', /не ответила вовремя/],
  ['checklist version of this evaluation is missing', /Версия чек-листа не найдена/],
  ['checklist version not found', /Версия чек-листа не найдена/],
  ['checklist cl-9 not found', /Версия чек-листа не найдена/],
  ['conversations not found: a, b', /Диалог не найден/],
  ['conversation demo-1 not found', /Диалог не найден/],
  ['evaluation not found', /Оценка не найдена/],
  ['evaluation eval-1 not found', /Оценка не найдена/],
  ['appeal not found', /Апелляция не найдена/],
  ['appeal appeal-1 not found', /Апелляция не найдена/],
  ['job not found', /Задача оценки не найдена/],
  ['job job-1 not found', /Задача оценки не найдена/],
  ['Network error: POST /api/evaluations', /Нет связи с сервером/],
  ['Unexpected response shape from GET /api/appeals', /неожиданный ответ/],
  ['invalid checklist', /не принял чек-лист/],
  ['invalid decision', /не принял решение/],
  ['invalid override', /не принял решение/],
  ['DATASET_IMPORT_URL is not configured on the server', /Импорт данных/],
  ['POST /api/evaluations failed with 502 (HTTP 502)', /Сервер ответил ошибкой/],
  ['evaluation failed', /Оценка не получилась/],
];

describe('humanError', () => {
  it.each(KNOWN)('%s', (message, expected) => {
    for (const e of [new Error(message), new CqaApiError('conflict', message), message]) {
      const h = humanError(e);
      expect(h.text).toMatch(expected);
      expect(h.detail).toBe(message); // the original stays available, folded
    }
  });

  it('falls back by error code, then generically, always in Russian', () => {
    expect(humanError(new CqaApiError('not_found', 'zzz')).text).toMatch(/Не найдено/);
    expect(humanError(new CqaApiError('invalid', '[{"code":"too_small"}]')).text).toMatch(/не прошли проверку/);
    expect(humanError(new Error('something odd')).text).toMatch(/Что-то пошло не так/);
  });

  it('passes Russian messages through unchanged', () => {
    expect(humanError('Выберите новый ответ')).toEqual({ text: 'Выберите новый ответ' });
  });
});
