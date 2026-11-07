import { CqaApiError } from '@/api/CqaApi';

/** What the reviewer reads, plus the original message for whoever debugs it (shown folded, never as the headline). */
export type HumanError = { text: string; detail?: string };

/**
 * Server, model and client messages are English and written for developers (apps/api, packages/contracts scoring,
 * the HTTP/mock clients). They are matched here by pattern, in one place; test/errors.test.ts feeds every known message
 * through so a reworded server message shows up as a failing test instead of English in the UI.
 * Follow-up: machine-readable error codes from the API would replace the patterns.
 */
const RULES: [RegExp, string | ((m: RegExpMatchArray) => string)][] = [
  [/pending appeal: decide the appeal instead/i, 'По этому критерию есть апелляция на рассмотрении: примите решение по ней.'],
  [/a pending appeal already exists/i, 'По этому критерию уже подана апелляция, она ждёт решения.'],
  [/appeal\b.*\bis already (upheld|overridden)/i, 'По этой апелляции уже принято решение. Обновите страницу.'],
  [/only a completed evaluation/i, 'Оценка ещё не завершена: изменить её пока нельзя.'],
  [/criterion\b.*\bis not part of this evaluation/i, 'Этого критерия нет в оценке: возможно, чек-лист изменился. Обновите страницу.'],
  [/(value .* is not allowed|N\/A is not allowed) for criterion/i, 'Такой ответ для этого критерия не допускается.'],
  [/(missing result|duplicate result|result for unknown criterion|non-N\/A result needs a value|enum criteria cannot carry weight)/i, 'Оценка не совпадает с чек-листом, балл не пересчитан.'],
  [/no model provider configured.*?(\d+) conversation/i, (m) => `Модель не подключена: на сервере не задан ключ API. Диалогов, которым нужна модель: ${m[1]}.`],
  [/no model provider configured/i, 'Модель не подключена: на сервере не задан ключ API.'],
  [/provider request failed \(status 429/i, 'Модель перегружена или исчерпан лимит запросов. Повторите через минуту.'],
  [/provider request failed \(status (\d+)/i, (m) => `Модель не ответила (код ${m[1]}). Повторите оценку.`],
  [/provider request failed/i, 'Модель не ответила. Повторите оценку.'],
  [/model returned no tool call/i, 'Модель ответила не в том формате. Повторите оценку.'],
  [/model output failed validation/i, 'Ответ модели не прошёл проверку (ссылки на сообщения или значения не сходятся), поэтому оценка не сохранена. Повторите оценку.'],
  [/a model is required for criteria: (.+)$/i, (m) => `Для критериев ${m[1]} нужна модель, а она не подключена.`],
  [/time(d)? ?out|aborted/i, 'Модель не ответила вовремя. Повторите оценку.'],
  [/checklist version (of this evaluation is missing|not found)|checklist .* not found|checklist not found/i, 'Версия чек-листа не найдена. Обновите страницу.'],
  [/conversations? not found|conversation .* not found/i, 'Диалог не найден. Обновите страницу.'],
  [/evaluation .*not found|evaluation not found/i, 'Оценка не найдена. Обновите страницу.'],
  [/appeal .*not found|appeal not found/i, 'Апелляция не найдена. Обновите страницу.'],
  [/job .*not found|job not found/i, 'Задача оценки не найдена: сервер мог перезапуститься. Повторите оценку.'],
  [/^Network error/i, 'Нет связи с сервером. Проверьте, что API запущен, и повторите.'],
  [/Unexpected response shape/i, 'Сервер прислал неожиданный ответ: версии клиента и сервера, похоже, не совпадают.'],
  [/invalid checklist/i, 'Сервер не принял чек-лист: проверьте поля критериев.'],
  [/invalid (decision|override)/i, 'Сервер не принял решение: проверьте ответ и обоснование.'],
  [/DATASET_IMPORT_URL|dataset/i, 'Импорт данных не настроен или источник недоступен.'],
  [/\(HTTP 5\d\d\)/, 'Сервер ответил ошибкой. Повторите попытку.'],
  [/^evaluation failed$/i, 'Оценка не получилась.'],
];

const BY_CODE = { not_found: 'Не найдено. Обновите страницу.', conflict: 'Данные уже изменились. Обновите страницу.', invalid: 'Данные не прошли проверку.' } as const;

/** Russian text for any thrown value or stored error string (e.g. Evaluation.error). Russian input passes through. */
export function humanError(e: unknown): HumanError {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  if (raw && /[а-яё]/i.test(raw) && !/[a-z]{4,}/i.test(raw)) return { text: raw };
  for (const [re, out] of RULES) {
    const m = raw.match(re);
    if (m) return { text: typeof out === 'string' ? out : out(m), detail: raw };
  }
  if (e instanceof CqaApiError) return { text: BY_CODE[e.code], detail: raw || undefined };
  return { text: 'Что-то пошло не так. Повторите попытку.', detail: raw || undefined };
}
