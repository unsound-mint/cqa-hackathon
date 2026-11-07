// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import demo from '../../../fixtures/demo.json';
import { ApiProvider } from '../src/ApiContext';
import { App } from '../src/App';
import { HttpCqaApi, MockCqaApi } from '../src/api';
import { richDemo, richDemoAppeals } from '../src/api/demoExtras';

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
  expect(screen.getByTitle(/Вымышленные данные/)).toBeTruthy();
});

it('shows the dialog: transcript, total, N/A reason and the demo label', async () => {
  renderApp();
  await transcriptReady();
  expect(panel().getByText('94,12')).toBeTruthy();
  // Mock mode is announced once, in the sidebar; the panel does not repeat it for every dialog.
  expect(screen.getByTitle(/Вымышленные данные/)).toBeTruthy();
  expect(panel().queryByLabelText(/Демо-данные/)).toBeNull();
  fireEvent.click(row(/Выявление потребности/));
  expect(panel().getByText(/Данных для ответа хватало с самого начала/)).toBeTruthy();
});

it('states points earned out of points possible, and which criteria are not counted', async () => {
  renderApp();
  await transcriptReady();
  // The banner is the score and the verdict; how the total is made (80 of 85 applicable, 02 not counted) is its tooltip,
  // because the rows below already show every lost point and every N/A.
  expect(panel().getByTitle('Набрано 80 из 85 применимых баллов; не применимы: 02. Итог пересчитан на 100.')).toBeTruthy();
  expect(panel().queryByText(/Потеряно/)).toBeNull();
  expect(panel().getByText('Грубых нарушений нет')).toBeTruthy();
});

it('shows normalized deductions and full-mark checks, excluding N/A and flags', async () => {
  renderApp();
  await transcriptReady();
  expect(panel().getByText('Снято баллов').nextElementSibling?.textContent).toBe('5,88');
  expect(panel().getByText('Полный балл').nextElementSibling?.textContent).toBe('5 / 6');
  expect(panel().getByText('Чек-лист').nextElementSibling?.textContent).toBe('v1');
});

it('does not invent deductions or passed checks when no criteria are applicable', async () => {
  renderApp(bundle((b) => {
    const e = b.evaluations[0];
    e.originalResults = [];
    e.finalResults = [];
    e.originalTotal = null;
    e.finalTotal = null;
  }));
  await transcriptReady();
  expect(panel().getByText('Снято баллов').nextElementSibling?.textContent).toBe('—');
  expect(panel().getByText('Полный балл').nextElementSibling?.textContent).toBe('—');
  expect(panel().getByText(/Нет применимых критериев/)).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Оценка' }).querySelector('.score-track')).toBeNull();
});

it('a collapsed row is one line with points of the weight; lost points are colored and explained when opened', async () => {
  renderApp();
  await transcriptReady();
  const partial = row(/Корректная и полная консультация/);
  expect(partial.textContent).toContain('15 из 20');
  expect(within(partial).getByText('15 из 20').className).toMatch(/bg-warn-soft/); // any loss is amber, not green
  expect(within(row(/Установление контакта/)).getByText('10 из 10').className).not.toMatch(/bg-/); // full marks: quiet
  // A row that lost points says why without being opened; a full-marks row stays one line.
  expect(partial.textContent).toMatch(/04Корректная и полная консультация.+/);
  expect(row(/Установление контакта/).querySelector('.line-clamp-2')).toBeNull();
  expect(partial.querySelector('.line-clamp-2')?.textContent?.length).toBeGreaterThan(10);
  fireEvent.click(partial);
  expect(panel().getByText('Потеряно 5 из 20 баллов.')).toBeTruthy();
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
  // The reason is in Russian; the model runner's own message is kept folded under "Подробности".
  expect(await screen.findByText(/Ответ модели не прошёл проверку/)).toBeTruthy();
  expect(screen.getByText('Подробности')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Повторить оценку' })).toBeTruthy();
});

it('marks a reviewer-changed criterion and shows the AI answer struck next to the final one', async () => {
  renderApp(bundle((b) => {
    const e = b.evaluations[0];
    e.finalResults.find((r: any) => r.criterionId === '04').value = 20;
    e.finalTotal = 100;
  }));
  await transcriptReady();
  expect(panel().getAllByText(/Изменено проверяющим/).length).toBeGreaterThan(0);
  expect(panel().getByText(/Исходная оценка ИИ: 94,12/)).toBeTruthy();
  expect(panel().getByLabelText(/Ответ ИИ был: 15 из 20/)).toBeTruthy();
});

it('files an appeal, then a reviewer overrides it: total changes, original AI answer stays visible', async () => {
  renderApp();
  await transcriptReady();
  fireEvent.click(row(/Корректная и полная консультация/));
  fireEvent.click(panel().getByRole('button', { name: 'Оспорить' }));
  fireEvent.change(panel().getByLabelText('Почему вы не согласны с оценкой?'), { target: { value: 'Клиенту всё объяснили' } });
  fireEvent.click(panel().getByRole('button', { name: 'Отправить апелляцию' }));
  expect(await panel().findByText('Апелляция ждёт решения')).toBeTruthy();
  expect(panel().getAllByText('Апелляция').length).toBeGreaterThan(0);

  // No decision is preselected: the reviewer has to choose one.
  expect((panel().getByRole('button', { name: 'Принять решение' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(panel().getByLabelText('Изменить оценку'));
  fireEvent.click(panel().getByLabelText(/Ступень 20 · 20 из 20/));
  expect(panel().getByText(/Итог диалога:/).textContent).toMatch(/94,12 → 100/);
  fireEvent.change(panel().getByLabelText('Обоснование решения'), { target: { value: 'Второстепенная деталь не требовалась' } });
  fireEvent.click(panel().getByRole('button', { name: 'Принять решение' }));

  expect(await panel().findByText(/Сохранено\. Итог диалога: 100/)).toBeTruthy();
  expect(panel().getByText(/Исходная оценка ИИ: 94,12/)).toBeTruthy();
  expect(panel().getByLabelText(/Ответ ИИ был: 15 из 20/)).toBeTruthy();
  // The reviewer's reason and the AI's own reasoning are both on screen, in Russian, without a system prefix.
  expect(panel().getAllByText('Второстепенная деталь не требовалась').length).toBeGreaterThan(0);
  expect(panel().getByText(/Исходный ответ ИИ: 15 из 20/)).toBeTruthy();
  expect(panel().queryByText(/Reviewer override/)).toBeNull();
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
  fireEvent.click(screen.getByRole('button', { name: 'Оценить диалог demo-ru-001' }));
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
  // A fresh criterion is not covered in errors before the reviewer has done anything wrong.
  expect(screen.queryByText(/Введите название критерия/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить как новую версию' }));
  // The attempt names each problem next to its field, in Russian; an empty instruction blocks the save too.
  expect(await screen.findByText(/Введите название критерия/)).toBeTruthy();
  expect(screen.getByText(/Нужно не меньше двух ступеней/)).toBeTruthy();
  expect(screen.getByText(/Опишите, как оценивать/)).toBeTruthy();
  expect(screen.queryByText(/expected|Too small/i)).toBeNull();
  expect(screen.queryByText(/Сохранена версия/)).toBeNull();
});

it('a deleted criterion can be put back before saving', async () => {
  renderApp(demo, '#/checklist');
  // Delete lives in the selected criterion's form; the list selects.
  fireEvent.click(within(await screen.findByRole('navigation', { name: 'Критерии' })).getByRole('button', { name: /^03/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Удалить критерий 03' }));
  expect(screen.queryByRole('button', { name: 'Удалить критерий 03' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Вернуть' }));
  expect(screen.getByRole('button', { name: 'Удалить критерий 03' })).toBeTruthy(); // restored and selected again
  expect(screen.getByText('Изменений нет.')).toBeTruthy();
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
  fireEvent.click(panel().getByRole('button', { name: 'Оспорить' }));
  fireEvent.keyDown(panel().getByLabelText('Почему вы не согласны с оценкой?'), { key: 'j' });
  expect(window.location.hash).toBe('#/dialog/demo-ru-001');
});

it('an unsent reason holds the dialog even after focus left the field (Russian о/л/т are J/K/N)', async () => {
  renderApp(bundle(withSecond));
  await transcriptReady();
  fireEvent.click(row(/Корректная и полная консультация/));
  fireEvent.click(panel().getByRole('button', { name: 'Оспорить' }));
  fireEvent.change(panel().getByLabelText('Почему вы не согласны с оценкой?'), { target: { value: 'Черновик' } });
  fireEvent.keyDown(document.body, { key: 'о' });
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(window.location.hash).toBe('#/dialog/demo-ru-001');
  expect((panel().getByLabelText('Почему вы не согласны с оценкой?') as HTMLTextAreaElement).value).toBe('Черновик');
});

it('a reviewer corrects a grade directly, without an appeal; the appeals queue stays for disputes', async () => {
  renderApp();
  await transcriptReady();
  fireEvent.click(row(/Корректная и полная консультация/));
  fireEvent.click(panel().getByRole('button', { name: 'Изменить оценку' }));
  expect((panel().getByLabelText(/Ступень 15 · 15 из 20/) as HTMLInputElement).disabled).toBe(true); // the current answer
  fireEvent.click(panel().getByLabelText(/Ступень 20 · 20 из 20/));
  fireEvent.change(panel().getByLabelText('Почему оценка другая'), { target: { value: 'Консультация полная' } });
  fireEvent.click(panel().getByRole('button', { name: 'Сохранить оценку' }));
  expect(await panel().findByText(/Сохранено\. Итог диалога: 100/)).toBeTruthy();
  expect(panel().getAllByText('Консультация полная').length).toBeGreaterThan(0);
  expect(panel().getByText(/Исходный ответ ИИ: 15 из 20/)).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: /Апелляции/ }));
  const list = within(await screen.findByRole('region', { name: 'Апелляции' }));
  expect(list.getByText(/Апелляций пока нет/)).toBeTruthy();
});

it('digit keys follow the rows as shown, also with only the rows needing attention', async () => {
  renderApp(bundle((b) => {
    for (const r of [...b.evaluations[0].originalResults, ...b.evaluations[0].finalResults]) if (r.criterionId === '07') r.confidence = 'low';
  }));
  await transcriptReady();
  fireEvent.click(panel().getByLabelText(/Требуют внимания/));
  fireEvent.keyDown(document.body, { key: '1' });
  expect(row(/^07/).getAttribute('aria-expanded')).toBe('true'); // the first row shown, not criterion 01
});

it('low-confidence results are visible without opening a row and can be isolated', async () => {
  renderApp(bundle((b) => { for (const r of b.evaluations[0].finalResults) if (r.criterionId === '02') r.confidence = 'low'; }));
  await transcriptReady();
  expect(panel().getByText('Проверить')).toBeTruthy();
  fireEvent.click(panel().getByLabelText(/Требуют внимания \(1\)/));
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
  expect(msg8.getByRole('button', { name: /^Открыть критерий 05: Эмпатия.*15 из 15$/ })).toBeTruthy();
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

it('the queue rail can be hidden and brought back; the choice is remembered and the header takes over navigation', async () => {
  window.innerWidth = 1600;
  renderApp(bundle(withSecond));
  await transcriptReady();
  fireEvent.click(screen.getByRole('button', { name: 'Скрыть очередь диалогов' }));
  expect(screen.queryByRole('navigation', { name: 'Очередь диалогов' })).toBeNull();
  expect(screen.getByRole('button', { name: /Следующий диалог/ })).toBeTruthy(); // previous/next move into the header
  expect(window.localStorage.getItem('cqa-queue-hidden')).toBe('1');
  fireEvent.click(screen.getByRole('button', { name: 'Показать очередь диалогов' }));
  expect(screen.getByRole('navigation', { name: 'Очередь диалогов' })).toBeTruthy();
});

it('the queue rail has the dialogs page filters as dropdowns (state with counts, language, channel), shared', async () => {
  window.innerWidth = 1600;
  renderApp(bundle(withSecond));
  await transcriptReady();
  const rail = within(screen.getByRole('navigation', { name: 'Очередь диалогов' }));
  expect(rail.queryByRole('button', { name: /требующему проверки/ })).toBeNull(); // the separate warning button is gone
  const state = rail.getByRole('combobox', { name: 'Что показать' }) as HTMLSelectElement;
  expect([...state.options].map((o) => o.textContent)).toEqual(['Все диалоги · 2', 'Грубые нарушения · 0', 'Нужна проверка · 0', 'Не оценены · 0']);
  fireEvent.change(rail.getByRole('combobox', { name: 'Язык' }), { target: { value: 'EN' } });
  expect(rail.queryAllByRole('button', { name: /demo-ru-/ }).length).toBe(0); // both demo dialogs are RU
  fireEvent.click(screen.getByRole('link', { name: 'Диалоги' }));
  const list = within(await screen.findByRole('region', { name: 'Диалоги' }));
  expect((list.getByRole('combobox', { name: 'Язык' }) as HTMLSelectElement).value).toBe('EN'); // one filter, both places
});

it('the side panes can be resized from the keyboard (and by dragging); the width is remembered and Enter resets it', async () => {
  window.innerWidth = 1600;
  renderApp(bundle(withSecond));
  await transcriptReady();
  const main = document.getElementById('content')!;
  const rail = screen.getByRole('separator', { name: 'Ширина очереди' });
  fireEvent.keyDown(rail, { key: 'End' });
  expect(main.style.getPropertyValue('--rail')).toBe('448px'); // 28rem at the 16px root of the test
  expect(JSON.parse(window.localStorage.getItem('cqa-pane-widths')!)).toMatchObject({ rail: 448 });
  fireEvent.keyDown(rail, { key: 'Enter' });
  expect(main.style.getPropertyValue('--rail')).toBe('17.5rem');
  expect(screen.getByRole('separator', { name: 'Ширина панели оценки' })).toBeTruthy();
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

it('on a call with a recording: evidence moves the player without playing; a message or an evidence chip plays exactly its fragment and stops', async () => {
  let now = 0;
  const set = vi.fn((v: number) => { now = v; });
  const play = vi.fn(() => Promise.resolve());
  const pause = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set').mockImplementation(set);
  vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockImplementation(() => now);
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(1);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause);
  renderApp(bundle((b) => { b.conversations[0].channel = 'voice call'; b.conversations[0].audioUrl = 'https://example.invalid/fictional.mp3'; }));
  await transcriptReady();
  const audio = document.querySelector('audio')!;

  fireEvent.click(row(/Идентификация/));
  fireEvent.click(screen.getAllByRole('button', { name: /^Перейти к сообщению 6/ })[0]!);
  expect(set).toHaveBeenLastCalledWith(64); // message 6 is at 01:04
  expect(play).not.toHaveBeenCalled(); // moving to the fragment does not start playback

  // Message 8 (01:25) runs until the next later message (#10, 01:48): 1 s lead-in, 0.5 s tail, then it stops.
  fireEvent.click(within(document.getElementById('msg-8')!).getByRole('button', { name: 'Прослушать фрагмент 01:25–01:48' }));
  expect(set).toHaveBeenLastCalledWith(84);
  expect(play).toHaveBeenCalledTimes(1);
  expect(within(document.getElementById('msg-8')!).getByRole('button', { name: 'Остановить фрагмент' })).toBeTruthy();
  now = 108.6;
  fireEvent(audio, new Event('timeupdate'));
  expect(pause).toHaveBeenCalled();
  expect(within(document.getElementById('msg-8')!).queryByRole('button', { name: 'Остановить фрагмент' })).toBeNull();
  expect(within(document.getElementById('msg-6')!).queryByRole('button', { name: /Прослушать/ })).toBeNull(); // system events have no speech

  // The evidence chip of a criterion plays its own moment too.
  fireEvent.click(panel().getAllByRole('button', { name: 'Прослушать фрагмент 01:25–01:48' })[0]!);
  expect(set).toHaveBeenLastCalledWith(84);
  expect(play).toHaveBeenCalledTimes(2);
});

it('"Прослушать фрагменты" plays every cited moment of a criterion in order, once each', async () => {
  let now = 0;
  const set = vi.fn((v: number) => { now = v; });
  vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set').mockImplementation(set);
  vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockImplementation(() => now);
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(1);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  renderApp(bundle((b) => { b.conversations[0].channel = 'voice call'; b.conversations[0].audioUrl = 'https://example.invalid/fictional.mp3'; }));
  await transcriptReady();
  const audio = document.querySelector('audio')!;
  fireEvent.click(row(/Эмпатия/)); // cites #7 (01:10) and #8 (01:25)
  fireEvent.click(panel().getByRole('button', { name: 'Прослушать фрагменты (2)' }));
  expect(set).toHaveBeenLastCalledWith(69);
  now = 85.6; // past #7's end (#8 starts at 01:25)
  fireEvent(audio, new Event('timeupdate'));
  expect(set).toHaveBeenLastCalledWith(84);
  fireEvent.click(row(/Корректная и полная консультация/)); // #8 and #9 share 01:25: one fragment, no "listen all"
  expect(panel().queryByRole('button', { name: /Прослушать фрагменты/ })).toBeNull();
});

it('a recording that fails to load says so, links the original, and hides fragment controls instead of hanging', async () => {
  renderApp(bundle((b) => { b.conversations[0].channel = 'voice call'; b.conversations[0].audioUrl = 'https://example.invalid/fictional.mp3'; }));
  await transcriptReady();
  expect(screen.getAllByRole('button', { name: /Прослушать фрагмент/ }).length).toBeGreaterThan(0);
  fireEvent(document.querySelector('audio')!, new Event('error'));
  expect(await screen.findByText(/Запись не загрузилась/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'открыть запись у организатора' }).getAttribute('href')).toBe('https://example.invalid/fictional.mp3');
  expect(screen.queryByRole('button', { name: /Прослушать фрагмент/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' })); // e.g. the server came back: controls return
  expect(screen.queryByText(/Запись не загрузилась/)).toBeNull();
  expect(screen.getAllByRole('button', { name: /Прослушать фрагмент/ }).length).toBeGreaterThan(0);
});

it('the call bar links to the chat: a marker plays that moment and shows its message, a click puts the playhead exactly there and shows the message spoken', async () => {
  let now = 0;
  const set = vi.fn((v: number) => { now = v; });
  vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set').mockImplementation(set);
  vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockImplementation(() => now);
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(130);
  const play = vi.fn(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  renderApp(bundle((b) => { b.conversations[0].channel = 'voice call'; b.conversations[0].audioUrl = 'https://example.invalid/fictional.mp3'; }));
  await transcriptReady();
  // Nothing open: markers sit on the messages behind lost points (04 cites #8 and #9, one fragment).
  const markers = within(screen.getByRole('group', { name: 'Доказательства на записи' }));
  fireEvent.click(markers.getAllByRole('button', { name: /Критерии 04/ })[0]!);
  expect(play).toHaveBeenCalled();
  expect(set).toHaveBeenLastCalledWith(84);
  expect(document.activeElement?.id).toBe('msg-8'); // the chat shows that message

  const bar = screen.getByRole('slider', { name: 'Запись звонка' });
  vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 130, top: 0, height: 40, right: 130, bottom: 40, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  fireEvent.pointerDown(bar, { clientX: 68 }); // about 1:05 into the call, inside client message #5 (01:03)
  fireEvent.pointerUp(bar, { clientX: 68 });
  expect(set.mock.lastCall![0]).toBeCloseTo(65.38, 1); // exactly where it was clicked, not snapped to 01:03
  expect(document.activeElement?.id).toBe('msg-5'); // the chat follows to the message spoken there
});

it('offers no player controls for a chat or for a call without a recording', async () => {
  renderApp();
  await transcriptReady();
  expect(screen.queryByRole('button', { name: /Прослушать/ })).toBeNull();
});

const renderApprover = (hash = '#/appeals') => {
  window.location.hash = hash;
  return render(
    <ApiProvider api={new MockCqaApi(richDemo(), richDemoAppeals())}>
      <App />
    </ApiProvider>,
  );
};

it('shows the approver a queue of appeals across dialogs, with a count on the sidebar item', async () => {
  renderApprover();
  const page = within(await screen.findByRole('region', { name: 'Апелляции' }));
  expect(page.getByRole('button', { name: /^На рассмотрении/ }).textContent).toContain('1');
  const link = page.getByRole('link', { name: 'demo-en-007' });
  expect(link.closest('tr')!.textContent).toContain('04 Корректная и полная консультация');
  expect(page.queryByRole('link', { name: 'demo-ru-023' })).toBeNull(); // decided: hidden under "На рассмотрении"
  expect(screen.getByLabelText('1 ждут решения')).toBeTruthy();
  fireEvent.click(page.getByRole('button', { name: /^Решённые/ }));
  const decided = page.getByRole('link', { name: 'demo-ru-023' }).closest('tr')!;
  expect(decided.textContent).toContain('Оценка ИИ оставлена');
});

it('opening an appeal lands on the dialog with that criterion open and the decision form ready; deciding clears the queue', async () => {
  renderApprover();
  const page = within(await screen.findByRole('region', { name: 'Апелляции' }));
  fireEvent.click(page.getByRole('link', { name: 'demo-en-007' }));
  const form = await screen.findByRole('form', { name: /Решение по апелляции, критерий 04/ });
  expect(window.location.hash).toBe('#/dialog/demo-en-007?criterion=04');
  fireEvent.click(within(form).getByLabelText('Изменить оценку'));
  fireEvent.click(within(form).getByLabelText(/Ступень 15 ·/));
  fireEvent.change(within(form).getByLabelText('Обоснование решения'), { target: { value: 'Совет открыть трекинг считается подсказкой' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Принять решение' }));
  expect(await screen.findByText(/Сохранено\. Итог диалога/)).toBeTruthy();
  expect(screen.queryByLabelText(/ждут решения/)).toBeNull(); // nothing waiting any more
  fireEvent.click(screen.getByRole('link', { name: /Апелляции/ }));
  const list = within(await screen.findByRole('region', { name: 'Апелляции' }));
  expect(list.getByText(/Нет обращений, ожидающих решения/)).toBeTruthy();
});

it('explains an empty approver queue', async () => {
  renderApp(demo, '#/appeals');
  expect(await screen.findByText(/Апелляций пока нет/)).toBeTruthy();
});

it('does not label an HTTP-backed workspace as a fictional offline demo', async () => {
  window.location.hash = '';
  const mock = new MockCqaApi(demo);
  const payloads: Record<string, unknown> = {
    '/api/conversations': await mock.listConversations(),
    '/api/evaluations': await mock.listEvaluations(),
    '/api/checklists': await mock.listChecklists(),
    '/api/appeals': await mock.listAppeals(),
  };
  const fetchFn = (async (url: string) => new Response(JSON.stringify(payloads[url.split('?')[0]!]), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  render(<ApiProvider api={new HttpCqaApi({ fetch: fetchFn })}><App /></ApiProvider>);
  await screen.findByRole('link', { name: 'demo-ru-001' });
  expect(screen.queryByTitle(/Вымышленные данные/)).toBeNull();
});

it('shows the statistics page from the sidebar for the demo data', async () => {
  renderApp(demo, '#/');
  fireEvent.click(await screen.findByRole('link', { name: /Статистика/ }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Статистика' })).toBeTruthy();
  expect(screen.getByText('Оценено диалогов')).toBeTruthy();
  expect(screen.getByRole('table', { name: 'Результаты по критериям' })).toBeTruthy();
  expect(document.title).toBe('Статистика · CQA');
});
