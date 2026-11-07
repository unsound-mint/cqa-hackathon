import type { Channel, ChecklistVersion, Conversation, Evaluation, Language } from '@cqa/contracts';
import { ArrowDown, ArrowUp, Headphones, MessagesSquare, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  /** Mock mode: say so next to the title. */
  demo?: boolean;
};

type SortKey = 'id' | 'score';

const LANGS: (Language | 'all')[] = ['all', 'RU', 'KZ', 'EN'];
const CHANNELS: { value: Channel | 'all'; label: string }[] = [
  { value: 'all', label: 'Все каналы' },
  { value: 'agent chat', label: 'Чат' },
  { value: 'voice call', label: 'Звонок' },
];

function Chip({ pressed, onClick, children, tone }: { pressed: boolean; onClick: () => void; children: React.ReactNode; tone?: 'danger' | 'warn' }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm transition-colors',
        pressed ? 'border-ink bg-ink text-canvas' : 'border-line bg-surface text-ink hover:border-line-strong',
        !pressed && tone === 'danger' && 'text-danger',
        !pressed && tone === 'warn' && 'text-warn',
      )}
    >
      {children}
    </button>
  );
}

function Status({ e }: { e: Evaluation | undefined }) {
  if (!e) return <Badge>Не оценён</Badge>;
  if (e.status === 'failed') return <Badge tone="danger">Ошибка оценки</Badge>;
  if (e.status !== 'completed') return <Badge tone="warn">Оценивается</Badge>;
  return <Badge tone="success">Оценён</Badge>;
}

/** The queue: every dialog with its score, the reason for a serious violation and what needs a human look. */
export function DialogsPage({ conversations, latest, checklists, filters, onFilters, onOpen, demo }: Props) {
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
    <Chip pressed={filters.quick === q} onClick={() => set({ quick: q })} tone={tone}>
      {label}
      <span className={cn('tabular-nums', filters.quick === q ? 'opacity-80' : 'text-muted')}>{n}</span>
    </Chip>
  );
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
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold leading-8">Диалоги</h1>
          {demo && <Badge tone="warn">Демо: вымышленные данные</Badge>}
        </div>
        <p className="text-sm text-muted">Очередь проверки: откройте диалог, чтобы увидеть оценку и её обоснование.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative block min-w-56 flex-1 sm:max-w-sm">
          <span className="sr-only">Поиск по номеру и тексту</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-3 size-4 text-muted" />
          <input type="search" value={filters.query} onChange={(e) => set({ query: e.target.value })} placeholder="Номер или текст диалога" className="h-10 w-full rounded-full border border-line bg-surface pl-9 pr-4 text-sm placeholder:text-muted" />
        </label>
        <div role="group" aria-label="Язык" className="flex gap-2">
          {LANGS.map((l) => (
            <Chip key={l} pressed={filters.lang === l} onClick={() => set({ lang: l })}>{l === 'all' ? 'Все языки' : l}</Chip>
          ))}
        </div>
        <div role="group" aria-label="Канал" className="flex gap-2">
          {CHANNELS.map((x) => (
            <Chip key={x.value} pressed={filters.channel === x.value} onClick={() => set({ channel: x.value })}>{x.label}</Chip>
          ))}
        </div>
      </div>

      <div role="group" aria-label="Что показать" className="flex flex-wrap gap-2">
        {quick('all', 'Все', c.all)}
        {quick('violations', 'Грубые нарушения', c.violations, 'danger')}
        {quick('review', 'Нужна проверка человеком', c.review, 'warn')}
        {quick('unevaluated', 'Не оценены', c.unevaluated)}
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
                      <span className="inline-flex items-center gap-2"><Badge tone="dark">{x.language}</Badge><span className="inline-flex items-center gap-1 text-muted"><Icon aria-hidden className="size-4" />{x.channel === 'voice call' ? 'Звонок' : 'Чат'}</span></span>
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
