// @vitest-environment jsdom
import axe from 'axe-core';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  await open('#/dialog/demo-ru-001', /Набрано/);
  fireEvent.click(screen.getAllByRole('button', { name: /Идентификация/ }).find((b) => b.hasAttribute('aria-expanded'))!);
  expect(await violations()).toEqual([]);
});

it('review screen of a voice call has none', async () => {
  await open('#/dialog/demo-ru-023', /Распознанная речь/);
  expect(await violations()).toEqual([]);
});

it('checklist editor has none', async () => {
  await open('#/checklist', 'Чек-лист');
  // Wide layout: the list selects, the form beside it edits (no accordion).
  fireEvent.click(within(await screen.findByRole('navigation', { name: 'Критерии' })).getAllByRole('button')[1]!);
  expect(screen.getByRole('region', { name: 'Критерий' })).toBeTruthy();
  expect(await violations()).toEqual([]);
});

it('sets a page title per screen and offers a skip link', async () => {
  await open('#/dialog/demo-ru-001', /Набрано/);
  expect(document.title).toBe('demo-ru-001 · CQA');
  expect(screen.getByRole('link', { name: 'Перейти к содержимому' })).toBeTruthy();
});
