// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import demo from '../../../fixtures/demo.json';
import { ApiProvider } from '../src/ApiContext';
import { App } from '../src/App';
import { MockCqaApi } from '../src/api';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const bundle = (patch: (b: any) => void = () => {}) => {
  const b = structuredClone(demo) as any;
  patch(b);
  return b;
};
const transcriptReady = async () => within(await screen.findByRole('region', { name: 'Транскрипт' })).findByText(/Личность клиента подтверждена/);
const renderApp = (b: unknown = demo) =>
  render(
    <ApiProvider api={new MockCqaApi(b)}>
      <App />
    </ApiProvider>,
  );

it('shows list, transcript and evaluation from MockCqaApi with the backend down, labelled as demo data', async () => {
  renderApp();
  await transcriptReady();
  expect(screen.getAllByText(/вымышленн/i).length).toBeGreaterThan(0);
  const panel = within(screen.getByRole('region', { name: 'Оценка' }));
  expect(panel.getByText('94,12')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Диалоги' })).getByText('94,12')).toBeTruthy();
  expect(screen.getByText(/Данных для ответа хватало с самого начала/)).toBeTruthy();
  expect(screen.getByText('N/A')).toBeTruthy();
});

it('keeps the original zero-based index and raw timestamp on every message', async () => {
  renderApp();
  await transcriptReady();
  const items = document.querySelectorAll('[id^="msg-"]');
  expect(items.length).toBe(13);
  const msg6 = document.getElementById('msg-6')!;
  expect(within(msg6).getByText('#6')).toBeTruthy();
});

it('clicking evidence moves focus to exactly that message, even when timestamps repeat', async () => {
  renderApp(bundle((b) => { for (const m of b.conversations[0].transcript) m.timestamp = '00:05'; }));
  await transcriptReady();
  const chip = screen.getAllByRole('button', { name: /^Перейти к сообщению 6/ })[0]!;
  fireEvent.click(chip);
  expect(document.activeElement?.id).toBe('msg-6');
});

it('selecting a criterion marks its evidence messages in the transcript', async () => {
  renderApp();
  await transcriptReady();
  expect(document.querySelectorAll('[data-cited]').length).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: /Идентификация клиента|Проверка личности|Идентификация/ }));
  const cited = [...document.querySelectorAll('[data-cited]')].map((el) => el.id);
  expect(cited).toEqual(['msg-6', 'msg-8']);
});

it('shows unusable evidence honestly instead of linking to a wrong message', async () => {
  renderApp(bundle((b) => { b.evaluations[0].finalResults[0].evidence = [{ messageIndex: 99, quote: 'нет' }]; b.evaluations[0].originalResults[0].evidence = [{ messageIndex: 99, quote: 'нет' }]; }));
  expect(await screen.findByText(/Сообщения #99 нет в транскрипте/)).toBeTruthy();
});

it('does not invent a score for an unevaluated conversation, and can start an evaluation', async () => {
  renderApp(bundle((b) => { b.evaluations = []; }));
  expect(await screen.findByText(/Диалог ещё не оценён/)).toBeTruthy();
  expect(screen.queryByText('/ 100')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Оценить диалог' }));
  expect((await screen.findAllByText(/MOCK placeholder/, {}, { timeout: 4000 })).length).toBeGreaterThan(0);
});

it('shows a failed evaluation with its reason and a retry button', async () => {
  renderApp(bundle((b) => { b.evaluations[0].status = 'failed'; b.evaluations[0].error = 'model output failed validation'; }));
  expect(await screen.findByText(/model output failed validation/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Повторить оценку' })).toBeTruthy();
});

it('marks a reviewer-changed criterion and shows the original AI answer next to the final one', async () => {
  renderApp(bundle((b) => {
    const e = b.evaluations[0];
    const f = e.finalResults.find((r: any) => r.criterionId === '04');
    f.value = 20;
    e.finalTotal = 100;
  }));
  expect(await screen.findByText(/Изменено ревьюером/)).toBeTruthy();
  expect(screen.getByText(/Исходная оценка ИИ: 94,12/)).toBeTruthy();
});

it('files an appeal, then a reviewer overrides it: final total changes, original AI answer stays visible', async () => {
  renderApp();
  await transcriptReady();
  const panel = within(screen.getByRole('region', { name: 'Оценка' }));
  fireEvent.click(panel.getAllByRole('button', { name: 'Оспорить оценку' })[3]!); // criterion 04
  fireEvent.change(panel.getByLabelText('Почему вы не согласны с оценкой?'), { target: { value: 'Клиенту всё объяснили' } });
  fireEvent.click(panel.getByRole('button', { name: 'Отправить апелляцию' }));
  expect(await panel.findByText('На рассмотрении')).toBeTruthy();

  fireEvent.click(panel.getByLabelText('Изменить оценку'));
  fireEvent.change(panel.getByLabelText('Новое значение'), { target: { value: 'v4' } }); // tier 20
  fireEvent.change(panel.getByLabelText('Обоснование решения'), { target: { value: 'Второстепенная деталь не требовалась' } });
  fireEvent.click(panel.getByRole('button', { name: 'Принять решение' }));

  expect(await panel.findByText('Оценка изменена ревьюером')).toBeTruthy();
  expect(await panel.findByText('100')).toBeTruthy();
  expect(panel.getByText(/Исходная оценка ИИ: 94,12/)).toBeTruthy();
  expect(panel.getByText(/Исходный ответ ИИ:/).textContent).toMatch(/15 из 20/);
});

it('adds a criterion in the editor, saves a new version, and evaluates a dialog with it without code changes', async () => {
  renderApp();
  await transcriptReady();
  fireEvent.click(screen.getByRole('button', { name: 'Чек-лист' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить критерий' }));
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Назвал срок решения' } });
  fireEvent.change(screen.getByLabelText(/Как оценивать/), { target: { value: 'Да, если оператор назвал срок.' } });
  fireEvent.change(screen.getByLabelText('Вес'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить как новую версию' }));
  expect(await screen.findByText(/Сохранена версия 2/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Оценить выбранный диалог' }));
  fireEvent.click(screen.getByRole('button', { name: 'Диалоги' }));
  expect(await screen.findByText('Назвал срок решения', {}, { timeout: 4000 })).toBeTruthy();
  const select = screen.getByLabelText('Оценка по версии чек-листа') as HTMLSelectElement;
  expect(select.options.length).toBe(2);
});

it('blocks saving an invalid criterion and says why', async () => {
  renderApp();
  fireEvent.click(await screen.findByRole('button', { name: 'Чек-лист' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить критерий' }));
  fireEvent.change(screen.getByLabelText('Тип ответа'), { target: { value: 'discrete-scale' } });
  fireEvent.change(screen.getByLabelText(/Ступени баллов/), { target: { value: '5' } });
  expect((screen.getByRole('button', { name: 'Сохранить как новую версию' }) as HTMLButtonElement).disabled).toBe(true);
  expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
});

it('filters the list to dialogs with a serious violation', async () => {
  renderApp(bundle((b) => { const e = b.evaluations[0]; e.seriousViolation = true; for (const r of [...e.originalResults, ...e.finalResults]) if (r.criterionId === '08') r.value = true; }));
  await transcriptReady();
  const list = within(screen.getByRole('region', { name: 'Диалоги' }));
  expect(list.getByText(/Только с грубыми нарушениями \(1\)/)).toBeTruthy();
  fireEvent.click(list.getByLabelText(/Только с грубыми нарушениями/));
  expect(list.getByText('demo-ru-001')).toBeTruthy();
  fireEvent.click(list.getByLabelText(/Только с грубыми нарушениями/));
  expect(list.getByText('1 из 1')).toBeTruthy();
});
