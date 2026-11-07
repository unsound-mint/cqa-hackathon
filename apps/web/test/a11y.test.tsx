// @vitest-environment jsdom
import axe from 'axe-core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { ApiProvider } from '../src/ApiContext';
import { App } from '../src/App';
import { MockCqaApi } from '../src/api';
import { richDemo } from '../src/api/demoExtras';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  window.location.hash = '';
});

/** Structural accessibility (names, roles, landmarks, headings, labels). Contrast needs real layout and is checked by hand. */
async function violations() {
  const res = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

const open = async (hash: string, wait: RegExp | string) => {
  window.location.hash = hash;
  render(
    <ApiProvider api={new MockCqaApi(richDemo())}>
      <App />
    </ApiProvider>,
  );
  await screen.findAllByText(wait);
};

it('dialogs list has no structural accessibility violations', async () => {
  await open('#/', 'Показано 4 из 4');
  expect(await violations()).toEqual([]);
});

it('review screen (chat view, criterion open) has none', async () => {
  await open('#/dialog/demo-ru-001', /Потеряно/);
  fireEvent.click(screen.getAllByRole('button', { name: /Идентификация/ }).find((b) => b.hasAttribute('aria-expanded'))!);
  expect(await violations()).toEqual([]);
});

it('review screen in list view with a voice call has none', async () => {
  await open('#/dialog/demo-ru-023', /Распознанная речь/);
  fireEvent.click(screen.getByRole('button', { name: 'Список' }));
  expect(await violations()).toEqual([]);
});

it('checklist editor has none', async () => {
  await open('#/checklist', 'Чек-лист');
  fireEvent.click((await screen.findAllByRole('button', { expanded: false }))[0]!);
  expect(await violations()).toEqual([]);
});

it('sets a page title per screen and offers a skip link', async () => {
  await open('#/dialog/demo-ru-001', /Потеряно/);
  expect(document.title).toBe('demo-ru-001 · CQA');
  expect(screen.getByRole('link', { name: 'Перейти к содержимому' })).toBeTruthy();
});
