import { can, type Actor, type Conversation, type Directory, type Task } from '@cqa/contracts';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/error-note';

type Props = {
  identity: Actor;
  tasks: Task[];
  directory: Directory;
  conversations: Conversation[];
  onOpenDialog: (id: string) => void;
  onOpenCrosscheck: (taskId: string) => void;
  onSample: (percent: number) => Promise<number>;
  onCancel: (taskId: string) => Promise<void>;
};

const fmt = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const KIND = { review: 'Проверка', crosscheck: 'Контрольная проверка' } as const;

/** QA's own work list; the top manager sees everyone's, the load per person and can sample dialogs for a second check. */
export function TasksPage({ identity, tasks, directory, conversations, onOpenDialog, onOpenCrosscheck, onSample, onCancel }: Props) {
  const manage = can(identity, 'task');
  const name = (id: string) => directory.people.find((p) => p.id === id)?.name ?? id;
  const [percent, setPercent] = useState(20);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const open = tasks.filter((t) => t.status === 'open');
  const closed = tasks.filter((t) => t.status !== 'open');
  const load = directory.people.filter((p) => p.role === 'reviewer').map((p) => ({ p, n: open.filter((t) => t.assigneeId === p.id).length }));
  const guard = async (f: () => Promise<void>) => {
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <section aria-label="Задачи" className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-4 overflow-auto p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold leading-8">{manage ? 'Задачи QA' : 'Мои задачи'}</h1>
        <p className="max-w-prose text-sm text-muted">{manage ? 'Работа, поручённая проверяющим: вручную из списка диалогов или автоматически тому, у кого меньше открытых задач. Контрольная проверка идёт другому проверяющему вслепую.' : 'Диалоги, которые вам поручили. Контрольная проверка выполняется вслепую: исходные поправки коллеги вам не показываются.'}</p>
      </div>

      {manage && (
        <div className="space-y-3 rounded-card border border-line bg-surface p-4 shadow-card">
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm" aria-label="Загрузка проверяющих">
            {load.length === 0 && <li className="text-muted">В справочнике нет проверяющих.</li>}
            {load.map(({ p, n }) => <li key={p.id}>{p.name}: <span className="font-medium tabular-nums">{n}</span> открыто</li>)}
          </ul>
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void guard(async () => { const n = await onSample(percent); setNote(n ? `Создано контрольных проверок: ${n}` : 'Подходящих проверенных диалогов нет.'); }); }}>
            <label htmlFor="sample" className="text-sm">Случайная выборка проверенных диалогов, %</label>
            <input id="sample" type="number" min={1} max={100} value={percent} onChange={(e) => setPercent(Number(e.target.value))} className="h-8 w-20 rounded-full border border-transparent bg-fill px-3 text-sm tabular-nums" />
            <Button type="submit" size="sm">Назначить контрольные проверки</Button>
            {note && <span role="status" className="text-sm text-muted">{note}</span>}
          </form>
          <ErrorNote error={error} />
        </div>
      )}

      {open.length === 0 ? (
        <div className="rounded-card border border-line bg-surface p-6 text-sm text-muted">Открытых задач нет.</div>
      ) : (
        <div className="overflow-auto rounded-card border border-line bg-surface shadow-card">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Открытые задачи</caption>
            <thead className="text-xs text-muted shadow-[0_1px_0_var(--c-line)]"><tr className="h-10 text-left"><th scope="col" className="px-3 font-medium">Диалог</th><th scope="col" className="px-3 font-medium">Что сделать</th>{manage && <th scope="col" className="px-3 font-medium">Кому</th>}<th scope="col" className="hidden px-3 font-medium sm:table-cell">Поручено</th><th scope="col" className="px-3" /></tr></thead>
            <tbody className="divide-y divide-line">
              {open.map((t) => {
                const mine = t.assigneeId === identity.id;
                const known = conversations.some((c) => c.id === t.conversationId);
                return (
                  <tr key={t.id} className="h-12">
                    <td className="whitespace-nowrap px-3 font-medium">{t.conversationId}</td>
                    <td className="px-3"><Badge tone={t.kind === 'crosscheck' ? 'warn' : 'neutral'}>{KIND[t.kind]}</Badge></td>
                    {manage && <td className="px-3">{name(t.assigneeId)}{t.auto && <span className="ml-2 text-xs text-muted">по загрузке</span>}</td>}
                    <td className="hidden px-3 text-muted tabular-nums sm:table-cell">{fmt(t.createdAt)}</td>
                    <td className="px-3 text-right">
                      <span className="inline-flex gap-2">
                        {t.kind === 'crosscheck' ? (mine && <Button size="sm" variant="primary" onClick={() => onOpenCrosscheck(t.id)}>Начать проверку</Button>) : (known && <Button size="sm" onClick={() => onOpenDialog(t.conversationId)}>Открыть диалог</Button>)}
                        {manage && <Button size="sm" variant="ghost" onClick={() => void guard(() => onCancel(t.id))}>Отменить</Button>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {closed.length > 0 && <p className="text-xs text-muted">Выполнено или отменено: {closed.length}</p>}
    </section>
  );
}
