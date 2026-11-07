import type { Conversation, Speaker } from '@cqa/contracts';
import { useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SPEAKER_LABEL } from '@/lib/present';

export type Focus = { index: number; nonce: number } | null;

type Props = {
  conversation: Conversation;
  /** Messages cited as evidence by the selected criterion. */
  cited: ReadonlySet<number>;
  /** Range inspected for an absence claim (inclusive). */
  checkedRange?: { from: number; to: number };
  /** Set when an evidence chip is clicked; `nonce` makes repeated clicks on the same message re-trigger. */
  focus: Focus;
  /** Messages worth a dot on the map: evidence of the selected criterion, of low-confidence results, of a raised flag. */
  markers: ReadonlyMap<number, 'evidence' | 'review' | 'violation'>;
  onSeek: (index: number) => void;
};

const TICK: Record<Speaker, string> = { client: 'h-5 bg-muted', operator: 'h-5 bg-accent', bot: 'h-5 bg-line-strong', system: 'h-2 bg-line-strong' };
const DOT = { evidence: 'bg-brand', review: 'bg-warn', violation: 'bg-danger' } as const;

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
      className="relative flex h-7 min-w-40 flex-1 cursor-pointer items-end gap-px rounded-md pt-2"
    >
      {conversation.transcript.map((x) => (
        <span key={x.index} aria-hidden className={cn('relative min-w-px flex-1 rounded-[2px]', TICK[x.speaker], x.index === current && 'outline-2 outline-ink')}>
          {markers.get(x.index) && <span className={cn('absolute -top-2 left-1/2 size-1.5 -translate-x-1/2 rounded-full', DOT[markers.get(x.index)!])} />}
        </span>
      ))}
    </div>
  );
}

const ROW: Record<Speaker, string> = {
  client: 'border-line bg-surface',
  operator: 'border-brand-dark/25 bg-brand-soft/50',
  bot: 'border-dashed border-line-strong bg-canvas text-muted',
  system: 'border-transparent bg-transparent text-muted italic',
};

export function Transcript({ conversation, cited, checkedRange, focus, markers, onSeek }: Props) {
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
      <header className="space-y-2 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Ход диалога</h2>
            <p className="text-xs text-muted">
              {conversation.language} · {conversation.channel === 'voice call' ? 'звонок' : 'чат'} · {conversation.transcript.length} сообщений · индексы с нуля, время как в исходнике
            </p>
          </div>
          {conversation.channel === 'voice call' && <Badge tone="warn">Распознанная речь: возможны ошибки в словах</Badge>}
        </div>
        {conversation.audioUrl && <audio controls preload="none" src={conversation.audioUrl} aria-label="Запись звонка" className="h-9 w-full" />}
        <div className="flex items-center gap-3">
          <ConversationMap conversation={conversation} markers={markers} current={focus?.index ?? 0} onSeek={onSeek} />
          <p className="hidden text-xs text-muted lg:block">Точки: основание критерия, проверка, нарушение</p>
        </div>
      </header>
      <ol start={0} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-4">
        {conversation.transcript.map((m) => {
          const isCited = cited.has(m.index);
          const inChecked = checkedRange && m.index >= checkedRange.from && m.index <= checkedRange.to;
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
                'grid grid-cols-[3.25rem_1fr] gap-x-3 rounded-lg border px-3 py-2 text-sm outline-none',
                ROW[m.speaker],
                isCited && 'border-brand ring-2 ring-brand/40',
                !isCited && inChecked && 'bg-fill',
                m.speaker === 'system' && 'py-1 text-xs',
              )}
            >
              <span className="select-none font-mono text-xs leading-6 text-muted">
                <span className="block">#{m.index}</span>
                <span className="block text-[11px]">{m.timestamp}</span>
              </span>
              <span className="min-w-0">
                <span className={cn('mr-2 text-xs font-semibold not-italic', m.speaker === 'operator' ? 'text-accent' : 'text-muted')}>{SPEAKER_LABEL[m.speaker]}</span>
                <span className="whitespace-pre-wrap break-words">{m.text}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
