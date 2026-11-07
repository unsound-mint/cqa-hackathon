import type { Conversation, Evaluation } from '@cqa/contracts';
import { Headphones, MessagesSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatScore } from '@/lib/present';
import { hasViolation, reviewCount } from '@/lib/queue';

type Props = { conversations: Conversation[]; latest: Map<string, Evaluation>; ids: string[]; selectedId: string; filterLabel: string | null; onSelect: (id: string) => void };

/** The current queue beside the review: score and flags per dialog, so the next one can be picked without leaving the page. */
export function QueueRail({ conversations, latest, ids, selectedId, filterLabel, onSelect }: Props) {
  const byId = new Map(conversations.map((c) => [c.id, c]));
  return (
    <nav aria-label="Очередь диалогов" className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">Очередь</h2>
        <p className="text-xs text-muted">{filterLabel ? `${filterLabel}: ${ids.length}` : `Все диалоги: ${ids.length}`}</p>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {ids.map((id) => {
          const c = byId.get(id);
          const e = latest.get(id);
          const active = id === selectedId;
          const Icon = c?.channel === 'voice call' ? Headphones : MessagesSquare;
          return (
            <li key={id}>
              <button type="button" onClick={() => onSelect(id)} aria-current={active ? 'true' : undefined} className={cn('w-full rounded-xl px-3 py-2 text-left transition-colors hover:bg-fill', active && 'bg-brand-soft ring-1 ring-brand/60')}>
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
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
