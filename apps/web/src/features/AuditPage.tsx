import { EventTypeSchema, type AuditEvent } from '@cqa/contracts';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '@/ApiContext';
import { Badge } from '@/components/ui/badge';
import { ErrorNote } from '@/components/ui/error-note';
import { Select } from '@/components/ui/field';
import { suspicious } from '@/lib/analytics';

const TYPE_LABEL: Record<string, string> = {
  'review.set': 'Проверка', 'result.corrected': 'Правка оценки', 'appeal.filed': 'Апелляция подана', 'appeal.decided': 'Апелляция решена', 'operator.assigned': 'Назначение оператора',
  'checklist.saved': 'Чек-лист', 'comment.added': 'Комментарий', 'comment.acknowledged': 'Ознакомление', 'task.created': 'Задача', 'task.done': 'Задача закрыта', 'crosscheck.submitted': 'Контрольная проверка',
  'tag.added': 'Причина ошибки', 'timeline.added': 'Событие шкалы', 'directory.changed': 'Справочник', 'taxonomy.changed': 'Категории', 'data.imported': 'Импорт', 'evaluation.started': 'Запуск оценки',
};
const KIND = { 'rubber-stamp': 'Пачка «Проверено»', 'one-direction': 'Правки в одну сторону', 'self-review': 'Решает по своей правке' } as const;
const fmt = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Who changed what and when, and the patterns worth a second look. The log is append-only on the server; the monitor
 * only points at patterns for a human to judge. The role is a demo switch, so this shows the pattern, not real security.
 */
export function AuditPage({ onOpenDialog }: { onOpenDialog: (id: string) => void }) {
  const api = useApi();
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [type, setType] = useState('all');
  const [actor, setActor] = useState('all');
  useEffect(() => {
    let live = true;
    api.listEvents({ limit: 5000 }).then((e) => live && setEvents(e), (e: unknown) => live && setError(e));
    return () => { live = false; };
  }, [api]);
  const findings = useMemo(() => suspicious(events ?? []), [events]);
  const actors = useMemo(() => [...new Set((events ?? []).map((e) => e.actorName))].sort((a, b) => a.localeCompare(b, 'ru')), [events]);
  const rows = (events ?? []).filter((e) => (type === 'all' || e.type === type) && (actor === 'all' || e.actorName === actor));
  return (
    <section aria-label="Журнал" className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-4 overflow-auto p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold leading-8">Журнал действий</h1>
        <p className="max-w-prose text-sm text-muted">Каждое действие человека: проверки, правки оценок, решения по апелляциям, назначения, чек-лист. Записи не редактируются. Роль в демо выбирается без входа, поэтому журнал показывает принцип, а не защиту.</p>
      </div>
      <ErrorNote error={error} />
      <div className="space-y-2 rounded-card border border-line bg-surface p-4 shadow-card">
        <h2 className="flex items-center gap-2 text-base font-semibold"><ShieldAlert aria-hidden className="size-5 text-warn" />На что стоит посмотреть</h2>
        {findings.length === 0 ? <p className="text-sm text-muted">Подозрительных закономерностей нет. Ищем: пачку «Проверено» за пару минут, правки только в одну сторону, решение по апелляции на диалоге, который человек сам исправлял.</p> : (
          <ul className="space-y-2 text-sm">{findings.map((f, i) => <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><Badge tone="warn">{KIND[f.kind]}</Badge><span className="font-medium">{f.actor}</span><span>{f.summary}</span><span className="text-xs text-muted tabular-nums">{fmt(f.at)}</span>{f.conversationIds.filter(Boolean).slice(0, 3).map((id) => <button key={id} type="button" onClick={() => onOpenDialog(id)} className="text-xs text-accent underline-offset-2 hover:underline">{id}</button>)}</li>)}</ul>
        )}
        <p className="text-xs text-muted">Это подсказки для человека, не выводы.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Select aria-label="Тип действия" value={type} onChange={(e) => setType(e.target.value)} className="h-8 w-auto rounded-full border-transparent bg-fill pl-3 pr-8 text-sm"><option value="all">Все действия</option>{EventTypeSchema.options.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] ?? t}</option>)}</Select>
        <Select aria-label="Кто" value={actor} onChange={(e) => setActor(e.target.value)} className="h-8 w-auto rounded-full border-transparent bg-fill pl-3 pr-8 text-sm"><option value="all">Все люди</option>{actors.map((a) => <option key={a} value={a}>{a}</option>)}</Select>
      </div>
      {events === null && !error ? <p className="text-sm text-muted">Загрузка…</p> : (
        <div className="overflow-auto rounded-card border border-line bg-surface shadow-card">
          <table className="w-full border-collapse text-sm"><caption className="sr-only">Журнал действий</caption>
            <thead className="sticky top-0 bg-surface text-xs text-muted shadow-[0_1px_0_var(--c-line)]"><tr className="h-10 text-left"><th scope="col" className="px-3 font-medium">Когда</th><th scope="col" className="px-3 font-medium">Кто</th><th scope="col" className="px-3 font-medium">Что</th><th scope="col" className="hidden px-3 font-medium sm:table-cell">Диалог</th></tr></thead>
            <tbody className="divide-y divide-line">{rows.slice(0, 500).map((e) => <tr key={e.id} className="align-top"><td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted">{fmt(e.at)}</td><td className="px-3 py-2">{e.actorName}{e.actorRole && <span className="block text-xs text-muted">{e.actorRole}</span>}</td><td className="px-3 py-2"><Badge className="mr-2">{TYPE_LABEL[e.type] ?? e.type}</Badge>{e.summary}</td><td className="hidden px-3 py-2 sm:table-cell">{e.conversationId && <button type="button" onClick={() => onOpenDialog(e.conversationId!)} className="text-accent underline-offset-2 hover:underline">{e.conversationId}</button>}</td></tr>)}</tbody>
          </table>
          {rows.length === 0 && <p className="p-4 text-sm text-muted">Записей нет.</p>}
        </div>
      )}
    </section>
  );
}
