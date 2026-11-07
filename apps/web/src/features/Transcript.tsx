import type { Conversation, Speaker } from '@cqa/contracts';
import { useEffect, useRef, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SPEAKER_LABEL, type Tone } from '@/lib/present';

export type Focus = { index: number; nonce: number } | null;
export type Tag = { id: string; tone: Tone };

type Props = {
  conversation: Conversation;
  /** Messages cited as evidence by the open criterion. */
  cited: ReadonlySet<number>;
  /** Range inspected for an absence claim (inclusive). */
  checkedRange?: { from: number; to: number };
  /** Set when an evidence chip is clicked; `nonce` makes repeated clicks on the same message re-trigger. */
  focus: Focus;
  /** Messages worth a dot on the map: evidence of the open criterion, of low-confidence results, of a raised flag. */
  markers: ReadonlyMap<number, 'evidence' | 'review' | 'violation'>;
  /** Criteria that cite each message, shown as small numbered tags that open that criterion. */
  tags: ReadonlyMap<number, Tag[]>;
  onTag: (criterionId: string) => void;
  onSeek: (index: number) => void;
  /** Title and queue controls of the dialog, rendered at the top of the card (replaces a separate title bar). */
  toolbar: ReactNode;
};

const TICK: Record<Speaker, string> = { client: 'h-5 bg-muted', operator: 'h-5 bg-accent', bot: 'h-5 bg-line-strong', system: 'h-2 bg-line-strong' };
const DOT = { evidence: 'bg-brand', review: 'bg-warn', violation: 'bg-danger' } as const;
const TAG = { neutral: 'bg-fill text-ink', success: 'bg-brand text-[#0e151c]', danger: 'bg-danger text-canvas', warn: 'bg-warn text-canvas' } as const;

/** One focusable slider over the whole dialog: arrow keys step through messages, a click jumps to the one under the pointer. */
function ConversationMap({ conversation, markers, current, onSeek }: { conversation: Conversation; markers: Props['markers']; current: number; onSeek: (i: number) => void }) {
  const n = conversation.transcript.length;
  const clamp = (i: number) => Math.max(0, Math.min(n - 1, i));
  const m = conversation.transcript[current];
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Карта диалога"
      aria-valuemin={0}
      aria-valuemax={n - 1}
      aria-valuenow={current}
      aria-valuetext={m ? `Сообщение ${m.index}, ${SPEAKER_LABEL[m.speaker].toLowerCase()}` : undefined}
      onKeyDown={(e) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, PageDown: 10, PageUp: -10 }[e.key];
        if (step !== undefined) onSeek(clamp(current + step));
        else if (e.key === 'Home') onSeek(0);
        else if (e.key === 'End') onSeek(n - 1);
        else return;
        e.preventDefault();
      }}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSeek(clamp(Math.floor(((e.clientX - r.left) / r.width) * n)));
      }}
      className="relative flex h-8 min-w-40 flex-1 cursor-pointer items-end gap-px rounded-lg pt-2"
    >
      {conversation.transcript.map((x) => (
        <span key={x.index} aria-hidden className={cn('relative min-w-px flex-1 rounded-[2px]', TICK[x.speaker], x.index === current && 'outline-2 outline-ink')}>
          {markers.get(x.index) && <span className={cn('absolute -top-2 left-1/2 size-2 -translate-x-1/2 rounded-full', DOT[markers.get(x.index)!])} />}
        </span>
      ))}
    </div>
  );
}

/** The graded party (operator) carries the visual weight; the client is plain; bot and system recede. */
const ROW: Record<Speaker, string> = {
  operator: 'border-transparent bg-fill',
  client: 'border-line bg-surface',
  bot: 'border-dashed border-line-strong bg-transparent text-muted',
  system: 'border-transparent bg-transparent text-muted',
};
const NAME: Record<Speaker, string> = { operator: 'text-accent', client: 'text-ink', bot: 'text-muted', system: 'text-muted' };

export function Transcript({ conversation, cited, checkedRange, focus, markers, tags, onTag, onSeek, toolbar }: Props) {
  const refs = useRef(new Map<number, HTMLLIElement>());

  useEffect(() => {
    if (!focus) return;
    const el = refs.current.get(focus.index);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
    el.classList.remove('flash');
    void el.offsetWidth; // restart the animation on repeated clicks
    el.classList.add('flash');
  }, [focus]);

  return (
    <section aria-label="Транскрипт" className="flex h-full min-h-0 flex-col">
      <header className="space-y-3 border-b border-line px-6 py-4">
        {toolbar}
        {conversation.channel === 'voice call' && <Badge tone="warn">Распознанная речь: возможны ошибки в словах</Badge>}
        {conversation.audioUrl && <audio controls preload="none" src={conversation.audioUrl} aria-label="Запись звонка" className="h-10 w-full" />}
        <div className="flex items-center gap-4">
          <ConversationMap conversation={conversation} markers={markers} current={focus?.index ?? 0} onSeek={onSeek} />
          <p className="hidden text-xs text-muted lg:block">Точки: основание, проверка, нарушение</p>
        </div>
      </header>
      <ol start={0} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {conversation.transcript.map((m) => {
          const isCited = cited.has(m.index);
          const inChecked = checkedRange && m.index >= checkedRange.from && m.index <= checkedRange.to;
          const mine = tags.get(m.index) ?? [];
          const system = m.speaker === 'system';
          return (
            <li
              key={m.index}
              id={`msg-${m.index}`}
              ref={(el) => {
                if (el) refs.current.set(m.index, el);
                else refs.current.delete(m.index);
              }}
              tabIndex={-1}
              data-cited={isCited || undefined}
              className={cn(
                'grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 rounded-xl border px-4 outline-none',
                system ? 'py-2' : 'py-3',
                ROW[m.speaker],
                inChecked && !isCited && 'bg-fill/60',
                isCited && 'border-brand bg-brand-soft ring-2 ring-brand/40',
              )}
            >
              <span className="select-none">
                <span className={cn('block text-sm font-medium', NAME[m.speaker])}>{SPEAKER_LABEL[m.speaker]}</span>
                <span className="block text-xs tabular-nums text-muted">
                  {m.timestamp} · #{m.index}
                </span>
              </span>
              <span className="min-w-0">
                <span className={cn('block whitespace-pre-wrap break-words', system ? 'text-sm italic' : 'text-base')}>{m.text}</span>
                {mine.length > 0 && (
                  <span className="mt-2 flex flex-wrap gap-1">
                    {mine.map((t) => (
                      <button key={t.id} type="button" onClick={() => onTag(t.id)} aria-label={`Открыть критерий ${t.id}`} className={cn('h-6 min-w-8 rounded-full px-2 text-xs font-semibold tabular-nums', TAG[t.tone])}>
                        {t.id}
                      </button>
                    ))}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
