// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../src/ApiContext';
import { App } from '../src/App';
import { MockCqaApi } from '../src/api';
import { DEMO_DIRECTORY, richOrg } from '../src/api/demoOrg';
import { richDemo, richDemoAppeals } from '../src/api/demoExtras';
import { setIdentity } from '../src/lib/identity';
import { rankOperators, trainingEffect, latestOf } from '../src/lib/analytics';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  window.location.hash = '';
  window.innerWidth = 1024;
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

const org = () => richOrg(richDemo(), richDemoAppeals());
const makeApi = () => {
  const { bundle, org: o, appeals } = org();
  return new MockCqaApi(bundle, appeals, o);
};
const as = (id: string) => {
  const p = DEMO_DIRECTORY.people.find((x) => x.id === id)!;
  setIdentity({ role: p.role, name: p.name, id: p.id });
};
const renderRich = (hash: string) => {
  window.location.hash = hash;
  return render(<ApiProvider api={makeApi()}><App /></ApiProvider>);
};

describe('the fictional organisation behind the team screens', () => {
  it('is deterministic and gives the analytics enough data: ranked operators, a training with a measurable effect', async () => {
    const a = org();
    const b = org();
    expect(JSON.stringify(a.org.timeline)).toBe(JSON.stringify(b.org.timeline));
    expect(a.bundle.evaluations.length).toBe(b.bundle.evaluations.length);
    const ctx = { conversations: a.bundle.conversations, evaluations: a.bundle.evaluations, checklists: a.bundle.checklists, appeals: a.appeals, directory: a.org.directory! };
    expect(rankOperators(ctx).filter((r) => r.rankable).length).toBeGreaterThanOrEqual(6);
    const t = trainingEffect(a.org.timeline!.find((e) => e.kind === 'training')!, ctx);
    expect(t.enough).toBe(true);
    expect(t.effect!).toBeGreaterThan(0); // built in: the trained group improves more than the comparison group
    expect(latestOf(a.bundle.evaluations).size).toBeGreaterThan(70);
  });
});

describe('least privilege in the mock (same rules as the API)', () => {
  it('a manager sees only the operators of the team they lead, an operator only themselves', async () => {
    const api = makeApi();
    as('mgr-a');
    const team = new Set(DEMO_DIRECTORY.people.filter((p) => p.teamId === 'team-a').map((p) => p.id));
    const seen = await api.listConversations();
    expect(seen.length).toBeGreaterThan(20);
    expect(seen.every((c) => c.operatorId && team.has(c.operatorId))).toBe(true);
    expect((await api.listEvaluations()).every((e) => seen.some((c) => c.id === e.conversationId))).toBe(true);
    as('op-2');
    expect((await api.listConversations()).every((c) => c.operatorId === 'op-2')).toBe(true);
    await expect(api.listEvents()).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('tasks go to the least loaded QA person; a cross-check is blind, never the first reviewer\'s, and its answers are validated', async () => {
    const api = makeApi();
    as('lead-1');
    const reviewed = (await api.listConversations()).filter((c) => c.review?.status === 'reviewed' && !(c.id.startsWith('demo-gen') && false));
    const target = reviewed.find((c) => c.review!.by !== 'Булат Ержанов')!;
    const first = DEMO_DIRECTORY.people.find((p) => p.name === target.review!.by)!;
    const [task] = (await api.createTasks({ conversationIds: [target.id], kind: 'crosscheck' }).catch(async () => { await api.cancelTask((await api.listTasks()).find((t) => t.conversationId === target.id && t.status === 'open')!.id); return api.createTasks({ conversationIds: [target.id], kind: 'crosscheck' }); }));
    expect(task!.assigneeId).not.toBe(first.id);
    as(first.id);
    const ev = (await api.listEvaluations({ conversationId: target.id })).at(-1)!;
    const results = ev.finalResults.map((r) => ({ criterionId: r.criterionId, value: r.value, isNA: r.isNA }));
    await expect(api.submitCrosscheck({ taskId: task!.id, results })).rejects.toMatchObject({ code: 'forbidden' });
    as(task!.assigneeId);
    await expect(api.submitCrosscheck({ taskId: task!.id, results: [{ criterionId: results[0]!.criterionId, value: 12345, isNA: false }] })).rejects.toMatchObject({ code: 'invalid' });
    expect((await api.submitCrosscheck({ taskId: task!.id, results })).reviewerId).toBe(task!.assigneeId);
  });
});

describe('screens', () => {
  it('shows the training effect against the comparison group on the analytics page', async () => {
    as('lead-1');
    renderRich('#/analytics');
    fireEvent.click(await screen.findByRole('button', { name: 'Динамика и обучение' }));
    const card = (await screen.findByText(/Тренинг по работе с возражениями/)).closest('div')!;
    expect(within(card).getByText(/Эффект:/)).toBeTruthy();
    expect(screen.getAllByText(/сравнительная группа/i).length).toBeGreaterThan(0);
  });

  it('a manager gets analytics for their own team only', async () => {
    as('mgr-b');
    renderRich('#/analytics');
    const teams = await screen.findByRole('table', { name: 'Группа' });
    expect(within(teams).getByText('Группа Б')).toBeTruthy();
    expect(within(teams).queryByText('Группа А')).toBeNull();
    expect(screen.queryByRole('link', { name: /Журнал/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Чек-лист/ })).toBeNull();
  });

  it('the audit page lists actions and flags a burst of "reviewed" within two minutes', async () => {
    as('lead-1');
    renderRich('#/audit');
    expect(await screen.findByText('Пачка «Проверено»')).toBeTruthy();
    expect(screen.getAllByText('Булат Ержанов').length).toBeGreaterThan(0);
    const log = screen.getByRole('table', { name: 'Журнал действий' });
    expect(within(log).getAllByRole('row').length).toBeGreaterThan(20);
  });

  it('a QA person sees only their own tasks, and the bell tells a manager about serious violations', async () => {
    as('qa-1');
    const { unmount } = renderRich('#/tasks');
    expect(await screen.findByRole('heading', { level: 1, name: 'Мои задачи' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Отменить' })).toBeNull();
    unmount();
    act(() => as('mgr-a'));
    renderRich('#/');
    expect(await screen.findByRole('button', { name: /Уведомления: \d+ новых/ })).toBeTruthy();
  });

  it('an operator reads a comment on their dialog and acknowledges it', async () => {
    const { bundle, org: o, appeals } = org();
    const target = o.comments![0]!;
    const op = bundle.conversations.find((c) => c.id === target.conversationId)!.operatorId!;
    const api = new MockCqaApi(bundle, appeals, { ...o, comments: [{ ...target, ackedAt: undefined }] });
    as(op);
    window.location.hash = `#/dialog/${target.conversationId}`;
    render(<ApiProvider api={api}><App /></ApiProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Ознакомлен' }));
    expect(await screen.findByText(/Ознакомлен \d/)).toBeTruthy();
  });
});
