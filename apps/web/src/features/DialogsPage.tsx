import { can, type Person, type Actor, type Channel, type ChecklistVersion, type Conversation, type Evaluation, type Language } from '@cqa/contracts';
import { ArrowDown, ArrowUp, Download, Headphones, MessagesSquare, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Segment } from '@/components/ui/segment';
import { cn } from '@/lib/utils';
import { downloadText, queueCsv } from '@/lib/export';
import { formatScore, REVIEW_LABEL } from '@/lib/present';
import { DEFAULT_FILTERS, NO_OPERATOR, counts, hasViolation, matches, reviewCount, reviewOf, sortConversations, violationReasons, type Filters, type Quick, type ReviewState, type Sort, type SortKey } from '@/lib/queue';
import { ErrorNote } from '@/components/ui/error-note';
import { AssignOperator } from './AssignOperator';

type Props = {
  failedCount?: number;
  onRetryFailed?: () => Promise<void>;
  retrying?: boolean;
  progress?: string | null;
  retryError?: unknown;
  attempts?: Map<string, Evaluation>;
  conversations: Conversation[];
  latest: Map<string, Evaluation>;
  checklists: ChecklistVersion[];
  filters: Filters;
  onFilters: (f: Filters) => void;
  onOpen: (id: string) => void;
  identity: Actor;
  people: Person[];
  onAssign: (conversationIds: string[], operator: string | null) => Promise<void>;
  /** Hand dialogs to QA: review, or a blind cross-check. Absent for roles that cannot. */
  onTasks?: (conversationIds: string[], kind: 'review' | 'crosscheck') => Promise<void>;
  followUpOpen: ReadonlySet<string>;
  /** Bumped to move focus into the search field. */
  focusSignal?: number;
};

const LANGS: (Language | 'all')[] = ['all', 'RU', 'KZ', 'EN'];
const CHANNELS: { value: Channel | 'all'; label: string }[] = [
  { value: 'all', label: 'Все каналы' },
  { value: 'agent chat', label: 'Чат' },
  { value: 'voice call', label: 'Звонок' },
];
const ORDERS: { value: string; label: string; sort: Sort }[] = [
  { value: 'queue', label: 'Порядок: очередь проверки', sort: { key: 'queue', dir: 1 } },
  { value: 'imported-desc', label: 'Порядок: сначала новые загрузки', sort: { key: 'imported', dir: -1 } },
  { value: 'imported-asc', label: 'Порядок: сначала старые загрузки', sort: { key: 'imported', dir: 1 } },
  { value: 'score-asc', label: 'Порядок: балл от низкого', sort: { key: 'score', dir: 1 } },
  { value: 'score-desc', label: 'Порядок: балл от высокого', sort: { key: 'score', dir: -1 } },
  { value: 'id', label: 'Порядок: по номеру', sort: { key: 'id', dir: 1 } },
];
const orderValue = (s: Sort) => ORDERS.find((o) => o.sort.key === s.key && o.sort.dir === s.dir)?.value ?? (s.key === 'review' ? 'queue' : 'id');

const stamp = (iso?: string) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

/** Only states that ask for something; an evaluated dialog is the normal case and carries no chip. */
function Status({ e }: { e: Evaluation | undefined }) {
  if (!e) return <Badge>Не оценён</Badge>;
  if (e.status === 'failed') return <Badge tone="danger">Ошибка оценки</Badge>;
  if (e.status !== 'completed') return <Badge tone="warn">Оценивается</Badge>;
  return null;
}

function ReviewChip({ c, e }: { c: Conversation; e: Evaluation | undefined }) {
  const r = reviewOf(c, e);
  if (r.state === 'new') return r.stale ? <Badge tone="warn" title={`Проверено ${stamp(r.at)}: ${r.by}. С тех пор диалог оценён заново.`}>Оценка обновлена</Badge> : <Badge>{REVIEW_LABEL.new}</Badge>;
  return <Badge tone={r.state === 'reviewed' ? 'success' : 'neutral'} title={`${r.by} · ${stamp(r.at)}`}>{REVIEW_LABEL[r.state]}</Badge>;
}

/** The queue: every dialog with its score, the reason for a serious violation and what needs a human look. */
export function DialogsPage({ failedCount = 0, onRetryFailed, retrying, progress, retryError, attempts, conversations, latest, checklists, filters, onFilters, onOpen, identity, people, onAssign, onTasks, followUpOpen, focusSignal = 0 }: Props) {
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusSignal > 0) search.current?.focus();
  }, [focusSignal]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const c = useMemo(() => counts(conversations, latest, { followUpOpen }), [conversations, latest, followUpOpen]);
  const checklistOf = (e: Evaluation | undefined) => checklists.find((x) => x.id === e?.checklistVersionId);
  const staff = identity.role !== 'operator';
  const canAssign = can(identity, 'assign');
  const sort = filters.sort;
  const nameOf = (id: string | null | undefined) => (id ? people.find((p) => p.id === id)?.name ?? id : undefined);

  const rows = useMemo(() => sortConversations(conversations.filter((x) => matches(x, latest.get(x.id), filters, { followUpOpen })), latest, sort), [conversations, latest, filters, sort, followUpOpen]);
  const knownOperators = useMemo(() => people.filter((x) => x.role === 'operator'), [people]);

  const set = (patch: Partial<Filters>) => onFilters({ ...filters, ...patch });
  const quick = (q: Quick, label: string, n: number, tone?: 'danger' | 'warn') => (
    <Segment pressed={filters.quick === q} onClick={() => set({ quick: q })} tone={tone}>
      {label}
      <span className="tabular-nums text-muted">{n}</span>
    </Segment>
  );
  const stage = (r: ReviewState | 'all', label: string, n: number) => (
    <Segment pressed={filters.review === r} onClick={() => set({ review: r })}>
      {label}
      <span className="tabular-nums text-muted">{n}</span>
    </Segment>
  );
  const narrow = 'h-8 w-auto rounded-full border-transparent bg-fill pl-3 pr-8 text-sm';
  const th = (key: SortKey, label: string, className?: string, first: 1 | -1 = 1) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={cn('px-3 py-2 text-left font-medium', className)}>
      <button type="button" onClick={() => set({ sort: sort.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: first } })} className="inline-flex min-h-8 items-center gap-1 rounded hover:text-ink">
        {label}
        {sort.key === key && (sort.dir === 1 ? <ArrowUp aria-hidden className="size-4" /> : <ArrowDown aria-hidden className="size-4" />)}
      </button>
    </th>
  );
  const allSelected = rows.length > 0 && rows.every((x) => selected.has(x.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((x) => x.id)));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  const chosen = [...selected].filter((id) => conversations.some((x) => x.id === id));

  return (
    <section aria-label="Диалоги" className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold leading-8">{staff ? 'Диалоги' : 'Мои диалоги'}</h1>
        {(failedCount > 0 || progress) && <div className="flex flex-wrap items-center gap-3 text-sm" role="status">
          <span>{progress ?? `Последняя оценка не получилась: ${failedCount}. Предыдущие успешные оценки сохранены.`}</span>
          {failedCount > 0 && onRetryFailed && <Button size="sm" disabled={retrying} onClick={() => void onRetryFailed()}>{retrying ? 'Повторяем…' : `Повторить неудавшиеся (${failedCount})`}</Button>}
        </div>}
        <ErrorNote error={retryError} />
        <p className="max-w-prose text-sm text-muted">{staff ? 'Очередь проверки: сверху то, что ещё никто не смотрел. Откройте диалог, чтобы увидеть оценку и её обоснование.' : 'Ваши диалоги с оценками. Откройте диалог, чтобы увидеть обоснование; если не согласны с оценкой, её можно оспорить.'}</p>
      </div>

      {/*
        One quiet toolbar: the review-state switch carries the decision (with counts); search and the rare filters
        (operator, language, channel, order) stay small. Nothing here is louder than the table it filters.
      */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {staff && (
          <div role="group" aria-label="Проверка" className="flex max-w-full flex-wrap gap-1 rounded-3xl bg-fill p-1">
            {stage('all', 'Все', c.all)}
            {stage('new', 'Новые', c.new)}
            {stage('in_review', 'В работе', c.in_review)}
            {stage('reviewed', 'Проверены', c.reviewed)}
          </div>
        )}
        <div role="group" aria-label="Что показать" className="flex max-w-full flex-wrap gap-1 rounded-3xl bg-fill p-1">
          {quick('all', 'Все', c.all)}
          {quick('violations', 'Грубые нарушения', c.violations, 'danger')}
          {quick('followup', 'Нарушения без разбора', c.followup, 'danger')}
          {quick('review', 'Нужна проверка', c.review, 'warn')}
          {quick('unevaluated', 'Не оценены', c.unevaluated)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative block min-w-48 flex-1 sm:max-w-xs">
          <span className="sr-only">Поиск по номеру и тексту</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-2 size-4 text-muted" />
          <input ref={search} type="search" value={filters.query} onChange={(e) => set({ query: e.target.value })} placeholder="Номер или текст" className="h-8 w-full rounded-full border border-transparent bg-fill pl-9 pr-3 text-sm placeholder:text-muted" />
        </label>
        {staff && (
          <Select aria-label="Оператор" value={filters.operator} onChange={(e) => set({ operator: e.target.value })} className={cn(narrow, filters.operator !== 'all' && 'border-ink font-medium')}>
            <option value="all">Все операторы</option>
            <option value={NO_OPERATOR}>Без оператора</option>
            {knownOperators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        )}
        <Select aria-label="Язык" value={filters.lang} onChange={(e) => set({ lang: e.target.value as Filters['lang'] })} className={cn(narrow, filters.lang !== 'all' && 'border-ink font-medium')}>
          {LANGS.map((l) => <option key={l} value={l}>{l === 'all' ? 'Все языки' : l}</option>)}
        </Select>
        <Select aria-label="Канал" value={filters.channel} onChange={(e) => set({ channel: e.target.value as Filters['channel'] })} className={cn(narrow, filters.channel !== 'all' && 'border-ink font-medium')}>
          {CHANNELS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </Select>
        <Select aria-label="Порядок" value={orderValue(sort)} onChange={(e) => set({ sort: ORDERS.find((o) => o.value === e.target.value)!.sort })} className={narrow}>
          {ORDERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </div>

      {canAssign && chosen.length > 0 && (
        <div role="group" aria-label="Назначить выбранные" className="flex flex-wrap items-center gap-3 rounded-xl bg-brand-soft px-4 py-2 text-sm">
          <span className="tabular-nums">Выбрано: {chosen.length}</span>
          <AssignOperator operators={knownOperators} submitLabel="Назначить оператору" compact onAssign={async (op) => { await onAssign(chosen, op); setSelected(new Set()); }} />
          <Button variant="ghost" size="sm" onClick={() => void onAssign(chosen, null).then(() => setSelected(new Set()))}>Снять оператора</Button>
          {onTasks && <Button size="sm" onClick={() => void onTasks(chosen, 'review').then(() => setSelected(new Set()))}>Поручить проверку</Button>}
          {onTasks && <Button size="sm" onClick={() => void onTasks(chosen, 'crosscheck').then(() => setSelected(new Set()))}>Контрольная проверка</Button>}
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Отменить выбор</Button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-card border border-line bg-surface p-6 text-sm">
          <p className="text-muted">{conversations.length === 0 ? (staff ? 'Диалогов пока нет. Импортируйте набор данных.' : 'За вами пока не закреплено ни одного диалога: их назначает руководитель.') : 'По этим условиям ничего не найдено.'}</p>
          {conversations.length > 0 && <Button className="mt-3" onClick={() => onFilters(DEFAULT_FILTERS)}>Сбросить фильтры</Button>}
        </div>
      ) : (
        <div className="min-h-0 overflow-auto rounded-card border border-line bg-surface shadow-card">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Диалоги с оценками</caption>
            <thead className="sticky top-0 z-10 bg-surface text-xs text-muted shadow-[0_1px_0_var(--c-line)]">
              <tr className="h-10">
                {canAssign && (
                  <th scope="col" className="w-8 px-3">
                    <label className="flex min-h-8 items-center"><span className="sr-only">Выбрать все</span><input type="checkbox" checked={allSelected} onChange={toggleAll} className="size-4 accent-brand" /></label>
                  </th>
                )}
                {th('id', 'Диалог')}
                <th scope="col" className="hidden px-3 py-2 text-left font-medium sm:table-cell">Язык и канал</th>
                {staff && <th scope="col" className="hidden px-3 py-2 text-left font-medium lg:table-cell">Оператор</th>}
                {th('imported', 'Загружен', 'hidden lg:table-cell', -1)}
                {th('score', 'Балл')}
                <th scope="col" className="hidden px-3 py-2 text-left font-medium md:table-cell">Грубое нарушение</th>
                {staff ? th('review', 'Проверка') : <th scope="col" className="px-3 py-2 text-left font-medium">Статус</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((x) => {
                const e = latest.get(x.id);
                const reasons = violationReasons(e, checklistOf(e));
                const review = reviewCount(e);
                const Icon = x.channel === 'voice call' ? Headphones : MessagesSquare;
                return (
                  <tr key={x.id} onClick={() => onOpen(x.id)} className="cursor-pointer align-top hover:bg-brand-soft/60">
                    {canAssign && (
                      <td className="px-3 py-3" onClick={(ev) => ev.stopPropagation()}>
                        <label className="flex min-h-8 items-center"><span className="sr-only">Выбрать {x.id}</span><input type="checkbox" checked={selected.has(x.id)} onChange={() => toggle(x.id)} className="size-4 accent-brand" /></label>
                      </td>
                    )}
                    <td className="px-3 py-3">
                      <a href={`#/dialog/${encodeURIComponent(x.id)}`} onClick={(ev) => ev.stopPropagation()} className="inline-flex min-h-6 items-center text-base font-medium text-accent underline-offset-2 hover:underline">{x.id}</a>
                      <div className="text-xs text-muted">{x.transcript.length} сообщ.</div>
                      {reasons.length > 0 && <p className="mt-1 text-xs text-danger md:hidden">{reasons[0]!.explanation}</p>}
                    </td>
                    <td className="hidden px-3 py-3 sm:table-cell">
                      <span className="inline-flex items-center gap-3"><span className="text-sm font-medium tabular-nums">{x.language}</span><span className="inline-flex items-center gap-1 text-muted"><Icon aria-hidden className="size-4" />{x.channel === 'voice call' ? 'Звонок' : 'Чат'}</span></span>
                    </td>
                    {staff && <td className="hidden px-3 py-3 lg:table-cell">{nameOf(x.operatorId) ?? <span className="text-muted">—</span>}</td>}
                    <td className="hidden px-3 py-3 whitespace-nowrap tabular-nums lg:table-cell">
                      {stamp(x.importedAt)}
                      {e?.createdAt && <div className="text-xs text-muted">оценён {stamp(e.createdAt)}</div>}
                    </td>
                    <td className="px-3 py-3 text-base font-semibold tabular-nums">{e?.status === 'completed' ? formatScore(e.finalTotal) : <span className="font-normal text-muted">—</span>}</td>
                    <td className="hidden max-w-md px-3 py-3 md:table-cell">
                      {hasViolation(e) ? (
                        <div className="space-y-1">
                          <Badge tone="danger">Грубое нарушение</Badge>
                          {reasons.map((r) => <p key={r.criterionId} className="text-xs text-muted">{r.explanation}</p>)}
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Status e={attempts?.get(x.id) ?? e} />
                        {staff && e && <ReviewChip c={x} e={e} />}
                        {review > 0 && <Badge tone="warn">Проверить: {review}</Badge>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted" aria-live="polite">Показано {rows.length} из {conversations.length}</p>
        {rows.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => downloadText('cqa-queue.csv', queueCsv(rows, latest), 'text/csv;charset=utf-8')}><Download aria-hidden className="size-4" />Скачать список (CSV)</Button>
        )}
      </div>
    </section>
  );
}
