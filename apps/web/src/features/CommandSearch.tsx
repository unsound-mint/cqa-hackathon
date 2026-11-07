import type { Conversation, Evaluation } from '@cqa/contracts';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatScore } from '@/lib/present';

type Props = { conversations: Conversation[]; latest: Map<string, Evaluation>; onOpen: (id: string) => void; onClose: () => void };

/** Quick finder (Ctrl K): by dialog id or by a phrase from the transcript. Enter opens the highlighted result. */
export function CommandSearch({ conversations, latest, onOpen, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations
      .map((c) => {
        const hit = q ? c.transcript.find((m) => m.text.toLowerCase().includes(q)) : undefined;
        return { c, hit, ok: !q || c.id.toLowerCase().includes(q) || !!hit };
      })
      .filter((x) => x.ok)
      .slice(0, 8);
  }, [conversations, query]);

  const open = (i: number) => {
    const r = results[i];
    if (r) onOpen(r.c.id);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-start justify-center bg-black/40 p-4 pt-24" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Поиск диалога" className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-card" onClick={(e) => e.stopPropagation()}>
        <label className="flex items-center gap-3 border-b border-line px-4">
          <Search aria-hidden className="size-4 text-muted" />
          <span className="sr-only">Номер диалога или фраза</span>
          <input
            ref={input}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') open(active);
            }}
            placeholder="Номер диалога или фраза из разговора"
            className="h-12 w-full bg-transparent text-base placeholder:text-muted"
          />
        </label>
        <ul role="listbox" aria-label="Результаты" className="max-h-80 overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-4 text-sm text-muted">Ничего не найдено.</li>}
          {results.map((r, i) => {
            const e = latest.get(r.c.id);
            return (
              <li key={r.c.id} role="option" aria-selected={i === active}>
                <button type="button" onMouseEnter={() => setActive(i)} onClick={() => open(i)} className={cn('w-full rounded-xl px-3 py-2 text-left', i === active && 'bg-fill')}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{r.c.id}</span>
                    <span className="text-xs text-muted">{r.c.language} · {e?.status === 'completed' ? formatScore(e.finalTotal) : 'не оценён'}</span>
                  </span>
                  {r.hit && <span className="mt-1 block truncate text-xs text-muted">#{r.hit.index}: {r.hit.text}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
