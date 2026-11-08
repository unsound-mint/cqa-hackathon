// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Comment, Person } from '@cqa/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialogComments } from '../src/features/DialogNotes';
import { RolePicker } from '../src/features/RolePicker';

afterEach(cleanup);

const people: Person[] = [
  { id: 'l1', name: 'Ирина Лидова', role: 'lead', teamId: null },
  { id: 'l2', name: 'Пётр Лидов', role: 'lead', teamId: null },
];

describe('RolePicker', () => {
  it('applies the first listed person when the identity names nobody (first visit)', () => {
    const onChange = vi.fn();
    render(<RolePicker identity={{ role: 'lead', name: 'Топ-менеджер' }} people={people} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Роль/ }));
    const apply = screen.getByRole('button', { name: 'Применить' });
    expect((apply as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(apply);
    expect(onChange).toHaveBeenCalledWith({ role: 'lead', name: 'Ирина Лидова', id: 'l1' });
  });

  it('offers to create the demo team when the directory is empty, for the lead only', () => {
    const seed = vi.fn().mockResolvedValue(undefined);
    render(<RolePicker identity={{ role: 'lead', name: 'Топ-менеджер' }} people={[]} onChange={() => {}} onSeedDemo={seed} />);
    fireEvent.click(screen.getByRole('button', { name: /Роль/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать демо-команду' }));
    expect(seed).toHaveBeenCalledOnce();
    cleanup();
    render(<RolePicker identity={{ role: 'manager', name: 'Менеджер группы' }} people={[]} onChange={() => {}} onSeedDemo={seed} />);
    fireEvent.click(screen.getByRole('button', { name: /Роль: Менеджер/ }));
    expect(screen.queryByRole('button', { name: 'Создать демо-команду' })).toBeNull();
  });
});

describe('DialogComments', () => {
  const comments: Comment[] = [
    { id: 'c1', conversationId: 'd1', authorName: 'QA', body: 'общий', createdAt: '2026-11-08T10:00:00Z' },
    { id: 'c2', conversationId: 'd1', criterionId: '04', authorName: 'QA', body: 'по критерию', createdAt: '2026-11-08T10:05:00Z' },
  ];
  const checklist = { id: 'cl', version: 1, title: 'T', createdAt: 'x', criteria: [{ id: '04', title: 'Корректность', instructions: '', weight: 10, kind: 'discrete-scale' as const, allowedValues: [0, 10], allowNA: false }] };

  it('shows criterion comments too, with the criterion named, and lets the operator acknowledge them', () => {
    render(<DialogComments identity={{ role: 'operator', name: 'Анна', id: 'o1' }} conversationId="d1" comments={comments} checklist={checklist} onAdd={async () => {}} onAck={async () => {}} />);
    expect(screen.getByText('по критерию')).toBeTruthy();
    expect(screen.getByText(/04 Корректность/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Ознакомлен' })).toHaveLength(2);
  });
});
