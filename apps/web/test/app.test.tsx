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
  document.documentElement.classList.remove('dark');
  window.innerWidth = 1024;
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

const bundle = (patch: (b: any) => void = () => {}) => {
  const b = structuredClone(demo) as any;
  patch(b);
  return b;
};
/** A second fictional dialog (clone of the first, new ids), so queue navigation has somewhere to go. */
const withSecond = (b: any) => {
  const c = structuredClone(b.conversations[0]);
  c.id = 'demo-ru-002';
  const e = structuredClone(b.evaluations[0]);
  e.id = 'eval-demo-ru-002';
  e.conversationId = 'demo-ru-002';
  b.conversations.push(c);
  b.evaluations.push(e);
};
const renderApp = (b: unknown = demo, hash = '#/dialog/demo-ru-001') => {
  window.location.hash = hash;
  return render(
    <ApiProvider api={new MockCqaApi(b)}>
      <App />
    </ApiProvider>,
  );
};
const transcript = async () => within(await screen.findByRole('region', { name: 'Транскрипт' }));
const transcriptReady = async () => (await transcript()).findByText(/Личность клиента подтверждена/);
const panel = () => within(screen.getByRole('region', { name: 'Оценка' }));
const row = (name: RegExp) => panel().getByRole('button', { name });

it('opens at the dialogs list: score, language and channel per row, no invented data', async () => {
  renderApp(demo, '');
  const list = within(await screen.findByRole('region', { name: 'Диалоги' }));
  const r = list.getByRole('link', { name: 'demo-ru-001' }).closest('tr')!;
  expect(within(r).getByText('94,12')).toBeTruthy();
  expect(within(r).getByText('RU')).toBeTruthy();
  expect(list.getByText('Показано 1 из 1')).toBeTruthy();
  expect(screen.getAllByText(/вымышленн/i).length).toBeGreaterThan(0);
});

it('shows the dialog: transcript, total, N/A reason and the demo label', async () => {
  renderApp();
  await transcriptReady();
  expect(panel().getByText('94,12')).toBeTruthy();
  expect(panel().getByLabelText(/Демо-данные: вымышленный пример/)).toBeTruthy();
  fireEvent.click(row(/Выявление потребности/));
  expect(panel().getByText(/Данных для ответа хватало с самого начала/)).toBeTruthy();
});

it('states points earned out of points possible, and which criteria are not counted', async () => {
  renderApp();
  await transcriptReady();
  expect(panel().getByText(/Набрано 80 из 85 возможных баллов/)).toBeTruthy();
  expect(panel().getByText(/Не применимы и не учитываются: 02/)).toBeTruthy();
});

it('a row shows a points bar only where points were lost, with the amount', async () => {
  renderApp();
  await transcriptReady();
  expect(row(/Корректная и полная консультация/).textContent).toContain('15 / 20 (−5)');
  expect(row(/Установление контакта/).textContent).not.toMatch(/\//); // full points: no bar, no fraction
});

it('keeps the original zero-based index and raw timestamp on every message', async () => {
  renderApp();
  await transcriptReady();
  expect(document.querySelectorAll('[id^="msg-"]').length).toBe(13);
  expect(document.getElementById('msg-6')!.textContent).toMatch(/01:04 · #6/);
});

it('clicking evidence moves focus to exactly that message, even when timestamps repeat', async () => {
  renderApp(bundle((b) => { for (const m of b.conversations[0].transcript) m.timestamp = '00:05'; }));
  await transcriptReady();
  fireEvent.click(row(/Идентификация/));
  fireEvent.click(screen.getAllByRole('button', { name: /^Перейти к сообщению 6/ })[0]!);
  expect(document.activeElement?.id).toBe('msg-6');
});

it('opening a criterion marks its evidence messages in the transcript and on the map', async () => {
  renderApp();
  await transcriptReady();
  expect(document.querySelectorAll('[data-cited]').length).toBe(0);
  fireEvent.click(row(/Идентификация/));
  expect([...document.querySelectorAll('[data-cited]')].map((el) => el.id)).toEqual(['msg-6', 'msg-8']);
  expect(row(/Идентификация/).getAttribute('aria-expanded')).toBe('true');
});

it('shows unusable evidence honestly instead of linking to a wrong message', async () => {
  renderApp(bundle((b) => { b.evaluations[0].finalResults[0].evidence = [{ messageIndex: 99, quote: 'нет' }]; b.evaluations[0].originalResults[0].evidence = [{ messageIndex: 99, quote: 'нет' }]; }));
  await transcriptReady();
  fireEvent.click(row(/Установление контакта/));
  expect(await screen.findByText(/Сообщения #99 нет в транскрипте/)).toBeTruthy();
});

it('does not invent a score for an unevaluated dialog, and can start an evaluation', async () => {
  renderApp(bundle((b) => { b.evaluations = []; }));
  expect(await screen.findByText(/Диалог ещё не оценён/)).toBeTruthy();
  expect(screen.queryByText('из 100')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Оценить диалог' }));
  fireEvent.click(await screen.findByRole('button', { name: /Установление контакта/ }, { timeout: 4000 }));
  expect((await screen.findAllByText(/MOCK placeholder/)).length).toBeGreaterThan(0);
});

it('shows a failed evaluation with its reason and a retry button', async () => {
  renderApp(bundle((b) => { b.evaluations[0].status = 'failed'; b.evaluations[0].error = 'model output failed validation'; }));
  expect(await screen.findByText(/model output failed validation/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Повторить оценку' })).toBeTruthy();
});

it('marks a reviewer-changed criterion and shows the AI answer struck next to the final one', async () => {
  renderApp(bundle((b) => {
    const e = b.evaluations[0];
    e.finalResults.find((r: any) => r.criterionId === '04').value = 20;
    e.finalTotal = 100;
  }));
  await transcriptReady();
  expect(panel().getAllByText(/Изменено ревьюером/).length).toBeGreaterThan(0);
  expect(panel().getByText(/Исходная оценка ИИ: 94,12/)).toBeTruthy();
  expect(panel().getByLabelText(/Ответ ИИ был: 15 из 20/)).toBeTruthy();
});

it('files an appeal, then a reviewer overrides it: total changes, original AI answer stays visible', async () => {
  renderApp();
  await transcriptReady();
  fireEvent.click(row(/Корректная и полная консультация/));
  fireEvent.click(panel().getByRole('button', { name: 'Оспорить оценку' }));
  fireEvent.change(panel().getByLabelText('Почему вы не согласны с оценкой?'), { target: { value: 'Клиенту всё объяснили' } });
  fireEvent.click(panel().getByRole('button', { name: 'Отправить апелляцию' }));
  expect(await panel().findByText('На рассмотрении')).toBeTruthy();
  expect(panel().getAllByText('Апелляция').length).toBeGreaterThan(0);

  fireEvent.click(panel().getByLabelText('Изменить оценку'));
  fireEvent.change(panel().getByLabelText('Новое значение'), { target: { value: 'v4' } });
  fireEvent.change(panel().getByLabelText('Обоснование решения'), { target: { value: 'Второстепенная деталь не требовалась' } });
  fireEvent.click(panel().getByRole('button', { name: 'Принять решение' }));

  expect(await panel().findByText('Оценка изменена ревьюером')).toBeTruthy();
  expect(await panel().findByText('100')).toBeTruthy();
  expect(panel().getByText(/Исходная оценка ИИ: 94,12/)).toBeTruthy();
  expect(panel().getByLabelText(/Ответ ИИ был: 15 из 20/)).toBeTruthy();
});

it('adds a criterion in the editor, saves a new version, and evaluates a dialog with it without code changes', async () => {
  renderApp();
  await transcriptReady();
  fireEvent.click(screen.getByRole('link', { name: 'Чек-лист' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить критерий' }));
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Назвал срок решения' } });
  fireEvent.change(screen.getByLabelText(/Как оценивать/), { target: { value: 'Да, если оператор назвал срок.' } });
  fireEvent.change(screen.getByLabelText('Вес'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить как новую версию' }));
  expect(await screen.findByText(/Сохранена версия 2/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Оценить выбранный диалог' }));
  fireEvent.click(screen.getByRole('link', { name: 'Диалоги' }));
  fireEvent.click(await screen.findByRole('link', { name: 'demo-ru-001' }));
  expect(await within(await screen.findByRole('region', { name: 'Оценка' })).findByText(/Назвал срок решения/, {}, { timeout: 4000 })).toBeTruthy();
  expect((screen.getByLabelText('Оценка по версии чек-листа') as HTMLSelectElement).options.length).toBe(2);
});

it('blocks saving an invalid criterion and says why', async () => {
  renderApp(demo, '#/checklist');
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить критерий' }));
  fireEvent.change(screen.getByLabelText('Тип ответа'), { target: { value: 'discrete-scale' } });
  fireEvent.change(screen.getByLabelText(/Ступени баллов/), { target: { value: '5' } });
  expect((screen.getByRole('button', { name: 'Сохранить как новую версию' }) as HTMLButtonElement).disabled).toBe(true);
  expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
});

it('lists dialogs with a serious violation together with the reason, via the quick filter', async () => {
  renderApp(
    bundle((b) => {
      const e = b.evaluations[0];
      e.seriousViolation = true;
      for (const r of [...e.originalResults, ...e.finalResults]) if (r.criterionId === '08') { r.value = true; r.explanation = 'Оператор нагрубил клиенту'; }
      withSecond(b);
      b.evaluations[1].seriousViolation = false;
    }),
    '',
  );
  const list = within(await screen.findByRole('region', { name: 'Диалоги' }));
  expect(list.getByText('Показано 2 из 2')).toBeTruthy();
  fireEvent.click(list.getByRole('button', { name: /Грубые нарушения/ }));
  expect(list.getByText('Показано 1 из 2')).toBeTruthy();
  expect(list.getAllByText('Оператор нагрубил клиенту').length).toBeGreaterThan(0);
  expect(list.queryByRole('link', { name: 'demo-ru-002' })).toBeNull();
  fireEvent.click(within(list.getByRole('group', { name: 'Что показать' })).getAllByRole('button')[0]!);
  expect(list.getByText('Показано 2 из 2')).toBeTruthy();
});

it('the dialog header shows the violation reasons, not just a flag', async () => {
  renderApp(bundle((b) => {
    const e = b.evaluations[0];
    e.seriousViolation = true;
    for (const r of [...e.originalResults, ...e.finalResults]) if (r.criterionId === '08') { r.value = true; r.explanation = 'Оператор нагрубил клиенту'; r.evidence = [{ messageIndex: 8 }]; }
  }));
  await transcriptReady();
  expect(panel().getByRole('alert').textContent).toMatch(/Грубое нарушение.*Оператор нагрубил клиенту/);
});

it('previous/next and J/K walk the filtered queue', async () => {
  renderApp(bundle(withSecond));
  await transcriptReady();
  expect((screen.getByRole('button', { name: /Предыдущий диалог/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('1 из 2')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'j' });
  expect(window.location.hash).toBe('#/dialog/demo-ru-002');
  expect(await screen.findByText('2 из 2')).toBeTruthy();
  expect((screen.getByRole('button', { name: /Следующий диалог/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(window, { key: 'k' });
  expect(window.location.hash).toBe('#/dialog/demo-ru-001');
});

it('keyboard shortcuts are ignored while typing', async () => {
  renderApp(bundle(withSecond));
  await transcriptReady();
  fireEvent.click(row(/Корректная и полная консультация/));
  fireEvent.click(panel().getByRole('button', { name: 'Оспорить оценку' }));
  fireEvent.keyDown(panel().getByLabelText('Почему вы не согласны с оценкой?'), { key: 'j' });
  expect(window.location.hash).toBe('#/dialog/demo-ru-001');
});

it('low-confidence results are visible without opening a row and can be isolated', async () => {
  renderApp(bundle((b) => { for (const r of b.evaluations[0].finalResults) if (r.criterionId === '02') r.confidence = 'low'; }));
  await transcriptReady();
  expect(panel().getByText('Проверить')).toBeTruthy();
  fireEvent.click(panel().getByLabelText(/Только требующие внимания \(1\)/));
  expect(panel().queryByRole('button', { name: /Установление контакта/ })).toBeNull();
  expect(panel().getByRole('button', { name: /Выявление потребности/ })).toBeTruthy();
});

it('marks voice calls as speech-recognition text', async () => {
  renderApp(bundle((b) => { b.conversations[0].channel = 'voice call'; }));
  await transcriptReady();
  expect(screen.getByText(/Распознанная речь/)).toBeTruthy();
});

it('switches to the dark theme and remembers the choice', async () => {
  renderApp();
  await transcriptReady();
  fireEvent.click(screen.getByRole('button', { name: 'Включить тёмную тему' }));
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(window.localStorage.getItem('cqa-theme')).toBe('dark');
  expect(screen.getByRole('button', { name: 'Включить светлую тему' })).toBeTruthy();
});

it('shows numbered criterion tags on the messages that back a grade, and a tag opens its criterion', async () => {
  renderApp();
  await transcriptReady();
  const msg8 = within(document.getElementById('msg-8')!);
  const tags = msg8.getAllByRole('button', { name: /Открыть критерий/ }).map((b) => b.textContent);
  expect(tags).toEqual(expect.arrayContaining(['03', '04', '05']));
  expect(msg8.getByRole('button', { name: /^Открыть критерий 05: Эмпатия.*Да$/ })).toBeTruthy();
  expect(msg8.getAllByText(/Клиент пожаловался на неудобство/).length).toBeGreaterThan(0); // preview text is in the DOM, shown on hover/focus
  fireEvent.click(msg8.getByRole('button', { name: /^Открыть критерий 05/ }));
  expect(row(/Эмпатия/).getAttribute('aria-expanded')).toBe('true');
});

it('search sits at the top of the queue: it filters the queue with the matching phrase, and Ctrl K focuses it', async () => {
  window.innerWidth = 1600;
  renderApp(bundle((b) => { withSecond(b); b.conversations[1].transcript[1].text = 'Особая фраза про курьера'; }));
  await transcriptReady();
  const rail = within(screen.getByRole('navigation', { name: 'Очередь диалогов' }));
  const box = rail.getByRole('searchbox') as HTMLInputElement;
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  expect(document.activeElement).toBe(box);
  fireEvent.change(box, { target: { value: 'курьера' } });
  expect(rail.getAllByRole('button', { name: /demo-ru-/ }).length).toBe(1);
  expect(rail.getByText('курьера').tagName).toBe('MARK');
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(window.location.hash).toBe('#/dialog/demo-ru-002');
  fireEvent.click(rail.getByRole('button', { name: 'Очистить поиск' }));
  expect(rail.getAllByRole('button', { name: /demo-ru-/ }).length).toBe(2);
});

it('Ctrl K away from the dialogs opens the list page and focuses its search; the sidebar has no search button', async () => {
  window.innerWidth = 900;
  renderApp(demo, '#/checklist');
  await screen.findByRole('button', { name: 'Добавить критерий' });
  expect(screen.queryByRole('button', { name: /Найти диалог/ })).toBeNull();
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  const list = within(await screen.findByRole('region', { name: 'Диалоги' }));
  expect(document.activeElement).toBe(list.getByRole('searchbox'));
});

it('keys 1-9 open criteria and Escape closes; N jumps to the next dialog needing attention', async () => {
  renderApp(
    bundle((b) => {
      withSecond(b);
      for (const r of b.evaluations[1].finalResults) if (r.criterionId === '02') r.confidence = 'low';
    }),
  );
  await transcriptReady();
  fireEvent.keyDown(window, { key: '3' });
  expect(row(/Идентификация/).getAttribute('aria-expanded')).toBe('true');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(row(/Идентификация/).getAttribute('aria-expanded')).toBe('false');
  const next = screen.getByRole('button', { name: /К диалогу, требующему проверки/ });
  expect((next as HTMLButtonElement).disabled).toBe(false);
  fireEvent.keyDown(window, { key: 'n' });
  expect(window.location.hash).toBe('#/dialog/demo-ru-002');
  await screen.findByText('2 из 2');
  expect((screen.getByRole('button', { name: /К диалогу, требующему проверки/ }) as HTMLButtonElement).disabled).toBe(true); // the only other dialog does not need attention
});

it('shows the transcript as a chat: client on the left, operator on the right, system centered', async () => {
  renderApp();
  await transcriptReady();
  expect(document.getElementById('msg-8')!.className).toContain('items-end');
  expect(document.getElementById('msg-1')!.className).toContain('items-start');
  expect(document.getElementById('msg-6')!.className).toContain('items-center');
  expect(screen.queryByRole('group', { name: 'Вид транскрипта' })).toBeNull();
  expect(screen.queryByRole('slider')).toBeNull();
});

it('marks long pauses between messages', async () => {
  renderApp(bundle((b) => { b.conversations[0].transcript[8].timestamp = '03:25'; }));
  await transcriptReady();
  expect(document.getElementById('msg-8')!.textContent).toMatch(/пауза 2 мин \d+ с/);
  expect(document.getElementById('msg-9')!.textContent).not.toMatch(/пауза/);
});

it('the queue rail lists the filtered dialogs and switches between them', async () => {
  window.innerWidth = 1600;
  renderApp(bundle(withSecond));
  await transcriptReady();
  const rail = within(screen.getByRole('navigation', { name: 'Очередь диалогов' }));
  expect(rail.getByRole('button', { name: /demo-ru-001/ }).getAttribute('aria-current')).toBe('true');
  fireEvent.click(rail.getByRole('button', { name: /demo-ru-002/ }));
  expect(window.location.hash).toBe('#/dialog/demo-ru-002');
});

it('exports the evaluation: CSV download and print for PDF', async () => {
  renderApp();
  await transcriptReady();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  (URL as any).createObjectURL = vi.fn(() => 'blob:x');
  (URL as any).revokeObjectURL = vi.fn();
  const print = vi.spyOn(window, 'print').mockImplementation(() => {});
  fireEvent.click(panel().getByRole('button', { name: 'Скачать оценку в CSV' }));
  expect(click).toHaveBeenCalled();
  fireEvent.click(panel().getByRole('button', { name: 'Печать или сохранить в PDF' }));
  expect(print).toHaveBeenCalled();
  expect(document.querySelector('article')!.textContent).toContain('Оценка диалога demo-ru-001');
});
