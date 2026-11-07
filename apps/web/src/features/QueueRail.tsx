import type { Conversation, Evaluation } from '@cqa/contracts';
import { Headphones, MessagesSquare, PanelLeftClose, Search, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { formatScore } from '@/lib/present';
import { hasViolation, reviewCount, type Quick } from '@/lib/queue';
import { Segment } from '@/components/ui/segment';

type Props = {
  conversations: Conversation[];
  latest: Map<string, Evaluation>;
  /** Dialogs of the current queue (already filtered, including by the search text). */
  ids: string[];
  selectedId: string;
  /** The review-state filter, shared with the dialogs page, and the counts it shows. */
  quick: Quick;
  counts: Record<Quick, number>;
  onQuick: (q: Quick) => void;
  query: string;
  onQuery: (q: string) => void;
  /** Bumped to move focus into the search field (sidebar button, Ctrl K). */
  focusSignal: number;
  onSelect: (id: string) => void;
  /** Collapses the rail; the transcript header then carries previous/next and the dialog picker. */
  onHide: () => void;
};

/** A short window of the first message containing the query, with the match marked. */
function Snippet({ c, q }: { c: Conversation; q: string }) {
  const needle = q.trim().toLowerCase();
  if (!needle) return null;
  const hit = c.transcript.find((m) => m.text.toLowerCase().includes(needle));
  if (!hit) return null;
  const i = hit.text.toLowerCase().indexOf(needle);
  const start = Math.max(0, i - 24);
  const before = (start > 0 ? '…' : '') + hit.text.slice(start, i);
  return (
    <span className="mt-2 block text-xs leading-4 text-muted">
      <span className="tabular-nums">#{hit.index}</span> {before}
      <mark className="rounded bg-brand/30 px-px text-ink">{hit.text.slice(i, i + needle.length)}</mark>
      {hit.text.slice(i + needle.length, i + needle.length + 64)}
    </span>
  );
}

/** The queue beside the review, with search on top: results stay in the queue, expanded with the matching phrase. */
export function QueueRail({ conversations, latest, ids, selectedId, quick, counts, onQuick, query, onQuery, focusSignal, onSelect, onHide }: Props) {
  const byId = new Map(conversations.map((c) => [c.id, c]));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusSignal > 0) {
      input.current?.focus();
      input.current?.select();
    }
  }, [focusSignal]);

  return (
    <nav aria-label="Очередь диалогов" className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-line px-4 py-4">
        <h2 className="sr-only">Очередь диалогов</h2>
        <div className="flex items-center gap-2">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Поиск по номеру и тексту диалогов</span>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-3 size-4 text-muted" />
            <input
              ref={input}
              type="search"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ids[0]) onSelect(ids[0]);
                else if (e.key === 'Escape') onQuery('');
              }}
              placeholder="Поиск"
              title="Поиск (Ctrl K)"
              className="h-10 w-full rounded-full border border-line bg-canvas pl-10 pr-10 text-sm placeholder:text-muted"
            />
            {query && (
              <button type="button" aria-label="Очистить поиск" onClick={() => onQuery('')} className="absolute right-1 top-1 grid size-8 place-items-center rounded-full text-muted hover:bg-fill hover:text-ink">
                <X aria-hidden className="size-4" />
              </button>
            )}
          </label>
          <button type="button" onClick={onHide} title="Скрыть очередь" aria-label="Скрыть очередь диалогов" className="grid size-10 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-fill hover:text-ink">
            <PanelLeftClose aria-hidden className="size-4" />
          </button>
        </div>
        {/* The same review states as the dialogs page (one shared filter); N still jumps to the next dialog needing attention. */}
        <div role="group" aria-label="Что показать" className="grid grid-cols-2 gap-1 rounded-2xl bg-fill p-1">
          {([['all', 'Все', null], ['violations', 'Нарушения', 'danger'], ['review', 'Проверка', 'warn'], ['unevaluated', 'Не оценены', null]] as const).map(([q, label, tone]) => (
            <Segment key={q} pressed={quick === q} onClick={() => onQuick(q)} className="min-w-0 justify-between gap-1 px-2 text-xs">
              <span className="flex min-w-0 items-center gap-1 truncate">
                {tone && <span aria-hidden className={cn('size-2 shrink-0 rounded-full', tone === 'danger' ? 'bg-danger' : 'bg-warn')} />}
                {label}
              </span>
              <span className="tabular-nums text-muted">{counts[q]}</span>
            </Segment>
          ))}
        </div>
        {query.trim() && (
          <p className="text-xs text-muted" aria-live="polite">Найдено: {ids.length}</p>
        )}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {ids.length === 0 && <li className="px-3 py-4 text-sm text-muted">Ничего не найдено.</li>}
        {ids.map((id) => {
          const c = byId.get(id);
          const e = latest.get(id);
          const active = id === selectedId;
          const Icon = c?.channel === 'voice call' ? Headphones : MessagesSquare;
          return (
            <li key={id}>
              <button type="button" onClick={() => onSelect(id)} aria-current={active ? 'true' : undefined} className={cn('w-full rounded-xl px-3 py-3 text-left transition-colors hover:bg-fill', active && 'bg-brand-soft ring-1 ring-brand/60')}>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{id}</span>
                  <span className="text-sm font-semibold tabular-nums">{e?.status === 'completed' ? formatScore(e.finalTotal) : <span className="font-normal text-muted">—</span>}</span>
                </span>
                <span className="mt-1 flex items-center gap-2 text-xs text-muted">
                  {c?.language} <Icon aria-hidden className="size-4" />
                  {hasViolation(e) && <span className="font-medium text-danger">нарушение</span>}
                  {reviewCount(e) > 0 && <span className="font-medium text-warn">проверить: {reviewCount(e)}</span>}
                  {!e && <span>не оценён</span>}
                </span>
                {c && <Snippet c={c} q={query} />}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
