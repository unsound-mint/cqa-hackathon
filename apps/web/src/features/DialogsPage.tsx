import type { Channel, ChecklistVersion, Conversation, Evaluation, Language } from '@cqa/contracts';
import { ArrowDown, ArrowUp, Headphones, MessagesSquare, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { formatScore } from '@/lib/present';
import { DEFAULT_FILTERS, counts, hasViolation, matches, reviewCount, violationReasons, type Filters, type Quick } from '@/lib/queue';

type Props = {
  conversations: Conversation[];
  latest: Map<string, Evaluation>;
  checklists: ChecklistVersion[];
  filters: Filters;
  onFilters: (f: Filters) => void;
  onOpen: (id: string) => void;
  /** Bumped to move focus into the search field. */
  focusSignal?: number;
};

type SortKey = 'id' | 'score';

const LANGS: (Language | 'all')[] = ['all', 'RU', 'KZ', 'EN'];
const CHANNELS: { value: Channel | 'all'; label: string }[] = [
  { value: 'all', label: 'Все каналы' },
  { value: 'agent chat', label: 'Чат' },
  { value: 'voice call', label: 'Звонок' },
];

/** One option of the review-state switch: a quiet segment; a colored dot (not colored text) marks violations and review. */
function Segment({ pressed, onClick, children, tone }: { pressed: boolean; onClick: () => void; children: React.ReactNode; tone?: 'danger' | 'warn' }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn('inline-flex h-8 items-center gap-2 rounded-full px-3 text-sm whitespace-nowrap transition-colors', pressed ? 'bg-surface font-medium text-ink shadow-card' : 'text-muted hover:text-ink')}
    >
      {tone && <span aria-hidden className={cn('size-2 rounded-full', tone === 'danger' ? 'bg-danger' : 'bg-warn')} />}
      {children}
    </button>
  );
}

/** Only states that ask for something; an evaluated dialog is the normal case and carries no chip. */
function Status({ e }: { e: Evaluation | undefined }) {
  if (!e) return <Badge>Не оценён</Badge>;
  if (e.status === 'failed') return <Badge tone="danger">Ошибка оценки</Badge>;
  if (e.status !== 'completed') return <Badge tone="warn">Оценивается</Badge>;
  return null;
}

/** The queue: every dialog with its score, the reason for a serious violation and what needs a human look. */
export function DialogsPage({ conversations, latest, checklists, filters, onFilters, onOpen, focusSignal = 0 }: Props) {
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusSignal > 0) search.current?.focus();
  }, [focusSignal]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const c = useMemo(() => counts(conversations, latest), [conversations, latest]);
  const checklistOf = (e: Evaluation | undefined) => checklists.find((x) => x.id === e?.checklistVersionId);

  const rows = useMemo(() => {
    const list = conversations.filter((x) => matches(x, latest.get(x.id), filters));
    if (!sort) return list;
    const val = (x: Conversation) => (sort.key === 'id' ? x.id : latest.get(x.id)?.finalTotal ?? Number.NEGATIVE_INFINITY);
    return [...list].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir);
  }, [conversations, latest, filters, sort]);

  const set = (patch: Partial<Filters>) => onFilters({ ...filters, ...patch });
  const quick = (q: Quick, label: string, n: number, tone?: 'danger' | 'warn') => (
    <Segment pressed={filters.quick === q} onClick={() => set({ quick: q })} tone={tone}>
      {label}
      <span className="tabular-nums text-muted">{n}</span>
    </Segment>
  );
  const narrow = 'h-8 w-auto rounded-full border-transparent bg-fill pl-3 pr-8 text-sm';
  const th = (key: SortKey, label: string, className?: string) => (
    <th scope="col" aria-sort={sort?.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={cn('px-3 py-2 text-left font-medium', className)}>
      <button type="button" onClick={() => setSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'score' ? -1 : 1 }))} className="inline-flex items-center gap-1 rounded hover:text-ink">
        {label}
        {sort?.key === key && (sort.dir === 1 ? <ArrowUp aria-hidden className="size-4" /> : <ArrowDown aria-hidden className="size-4" />)}
      </button>
    </th>
  );

  return (
    <section aria-label="Диалоги" className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold leading-8">Диалоги</h1>
        <p className="max-w-prose text-sm text-muted">Очередь проверки: откройте диалог, чтобы увидеть оценку и её обоснование.</p>
      </div>

      {/*
        One quiet toolbar: the review-state switch carries the decision (with counts); search and the two rare filters
        (language, channel) stay small. Nothing here is louder than the table it filters.
      */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="group" aria-label="Что показать" className="flex max-w-full flex-wrap gap-1 rounded-3xl bg-fill p-1">
          {quick('all', 'Все', c.all)}
          {quick('violations', 'Грубые нарушения', c.violations, 'danger')}
          {quick('review', 'Нужна проверка', c.review, 'warn')}
          {quick('unevaluated', 'Не оценены', c.unevaluated)}
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <label className="relative block min-w-48 flex-1 sm:max-w-xs">
            <span className="sr-only">Поиск по номеру и тексту</span>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-2 size-4 text-muted" />
            <input ref={search} type="search" value={filters.query} onChange={(e) => set({ query: e.target.value })} placeholder="Номер или текст" className="h-8 w-full rounded-full border border-transparent bg-fill pl-9 pr-3 text-sm placeholder:text-muted" />
          </label>
          <Select aria-label="Язык" value={filters.lang} onChange={(e) => set({ lang: e.target.value as Filters['lang'] })} className={cn(narrow, filters.lang !== 'all' && 'border-ink font-medium')}>
            {LANGS.map((l) => <option key={l} value={l}>{l === 'all' ? 'Все языки' : l}</option>)}
          </Select>
          <Select aria-label="Канал" value={filters.channel} onChange={(e) => set({ channel: e.target.value as Filters['channel'] })} className={cn(narrow, filters.channel !== 'all' && 'border-ink font-medium')}>
            {CHANNELS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </Select>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-card border border-line bg-surface p-6 text-sm">
          <p className="text-muted">{conversations.length === 0 ? 'Диалогов пока нет. Импортируйте набор данных.' : 'По этим условиям ничего не найдено.'}</p>
          {conversations.length > 0 && <Button className="mt-3" onClick={() => onFilters(DEFAULT_FILTERS)}>Сбросить фильтры</Button>}
        </div>
      ) : (
        <div className="min-h-0 overflow-auto rounded-card border border-line bg-surface shadow-card">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Диалоги с оценками</caption>
            <thead className="sticky top-0 z-10 bg-surface text-xs text-muted shadow-[0_1px_0_var(--c-line)]">
              <tr className="h-10">
                {th('id', 'Диалог')}
                <th scope="col" className="hidden px-3 py-2 text-left font-medium sm:table-cell">Язык и канал</th>
                {th('score', 'Балл')}
                <th scope="col" className="hidden px-3 py-2 text-left font-medium md:table-cell">Грубое нарушение</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Статус</th>
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
                    <td className="px-3 py-3">
                      <a href={`#/dialog/${encodeURIComponent(x.id)}`} onClick={(ev) => ev.stopPropagation()} className="text-base font-medium text-accent underline-offset-2 hover:underline">{x.id}</a>
                      <div className="text-xs text-muted">{x.transcript.length} сообщ.</div>
                      {reasons.length > 0 && <p className="mt-1 text-xs text-danger md:hidden">{reasons[0]!.explanation}</p>}
                    </td>
                    <td className="hidden px-3 py-3 sm:table-cell">
                      <span className="inline-flex items-center gap-3"><span className="text-sm font-medium tabular-nums">{x.language}</span><span className="inline-flex items-center gap-1 text-muted"><Icon aria-hidden className="size-4" />{x.channel === 'voice call' ? 'Звонок' : 'Чат'}</span></span>
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
                      <div className="flex flex-wrap gap-2"><Status e={e} />{review > 0 && <Badge tone="warn">Проверить: {review}</Badge>}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted" aria-live="polite">Показано {rows.length} из {conversations.length}</p>
    </section>
  );
}
