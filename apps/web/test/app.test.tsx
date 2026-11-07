// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ApiProvider } from '../src/ApiContext';
import { App } from '../src/App';
import { MockCqaApi } from '../src/api';

afterEach(cleanup);

it('renders transcript and results from MockCqaApi with the backend down', async () => {
  render(
    <ApiProvider api={new MockCqaApi()}>
      <App />
    </ApiProvider>,
  );
  expect(await screen.findByText(/Личность клиента подтверждена/)).toBeTruthy();
  expect(screen.getByText(/MOCK DATA/)).toBeTruthy();
  expect(screen.getByText(/Total: 94.12/)).toBeTruthy();
  expect(screen.getByText(/N\/A — Данных для ответа/)).toBeTruthy();
});
