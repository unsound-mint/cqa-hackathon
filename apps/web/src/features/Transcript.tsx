import type { Conversation, Speaker } from '@cqa/contracts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SPEAKER_LABEL, gapLabel, type Tone } from '@/lib/present';

export type Focus = { index: number; nonce: number } | null;
export type Tag = { id: string; tone: Tone; title: string; label: string; explanation: string };

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
  /** The open criterion, if any. */
  activeId: string | null;
  onSeek: (index: number) => void;
  /** Title and queue controls of the dialog, rendered at the top of the card (replaces a separate title bar). */
  toolbar: ReactNode;
};

const TICK: Record<Speaker, string> = { client: 'h-5 bg-muted', operator: 'h-5 bg-accent', bot: 'h-5 bg-line-strong', system: 'h-2 bg-line-strong' };
const DOT = { evidence: 'bg-brand', review: 'bg-warn', violation: 'bg-danger' } as const;
/** Tags are quiet tints; only the open criterion's tag is solid, so the eye lands on the evidence being discussed. */
const TAG = { neutral: 'bg-fill text-muted', success: 'bg-brand-soft text-accent', danger: 'bg-danger-soft text-danger', warn: 'bg-warn-soft text-warn' } as const;
const TAG_ACTIVE = { neutral: 'bg-ink text-canvas', success: 'bg-brand text-[#0e151c]', danger: 'bg-danger text-canvas', warn: 'bg-warn text-canvas' } as const;

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

type View = 'chat' | 'rows';
const VIEW_KEY = 'cqa-transcript-view';
function readView(): View {
  try {
    const v = window.localStorage.getItem(VIEW_KEY);
    if (v === 'chat' || v === 'rows') return v;
  } catch {
    /* blocked storage: use the default */
  }
  return 'chat';
}

/** Chat view: client on the left, operator (the graded party) on the right, bot dimmed, system as small centered notes. */
const BUBBLE: Record<Speaker, string> = {
  operator: 'rounded-2xl rounded-tr-sm bg-brand-soft',
  client: 'rounded-2xl rounded-tl-sm border border-line bg-surface',
  bot: 'rounded-2xl rounded-tl-sm border border-dashed border-line-strong text-muted',
  system: 'rounded-full bg-fill px-4 py-1 text-sm italic text-muted',
};

export function Transcript({ conversation, cited, checkedRange, focus, markers, tags, onTag, activeId, onSeek, toolbar }: Props) {
  const refs = useRef(new Map<number, HTMLLIElement>());
  const [view, setView] = useState<View>(readView);
  const pick = (v: View) => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* not persisted */
    }
  };

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
        <div className="flex items-center gap-4" title="Карта диалога. Точки: основание критерия, проверка человеком, нарушение">
          <ConversationMap conversation={conversation} markers={markers} current={focus?.index ?? 0} onSeek={onSeek} />
          <div role="group" aria-label="Вид транскрипта" className="flex shrink-0 gap-1 rounded-full bg-fill p-1">
            {([['chat', 'Чат'], ['rows', 'Список']] as const).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={view === id} onClick={() => pick(id)} className={cn('h-8 rounded-full px-3 text-sm transition-colors', view === id ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted hover:text-ink')}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>
      <ol start={0} className={cn('min-h-0 flex-1 overflow-y-auto p-4', view === 'chat' ? 'space-y-4' : 'space-y-2')}>
        {conversation.transcript.map((m, k) => {
          const isCited = cited.has(m.index);
          const inChecked = checkedRange && m.index >= checkedRange.from && m.index <= checkedRange.to;
          const mine = tags.get(m.index) ?? [];
          const system = m.speaker === 'system';
          const gap = gapLabel(conversation.transcript[k - 1]?.timestamp, m.timestamp);
          const setRef = (el: HTMLLIElement | null) => {
            if (el) refs.current.set(m.index, el);
            else refs.current.delete(m.index);
          };
          const tagRow = mine.length > 0 && (
            <span className={cn('mt-2 flex flex-wrap gap-1', view === 'chat' && m.speaker === 'operator' && 'justify-end', view === 'chat' && system && 'justify-center')}>
              {mine.map((t) => (
                <span key={t.id} className="group relative">
                  <button type="button" onClick={() => onTag(t.id)} aria-label={`Открыть критерий ${t.id}: ${t.title}, ${t.label}`} className={cn('h-6 min-w-8 rounded-full px-2 text-xs font-semibold tabular-nums', (activeId === t.id ? TAG_ACTIVE : TAG)[t.tone])}>
                    {t.id}
                  </button>
                  {/* Preview on hover or keyboard focus: which criterion, its verdict and the reason. Decorative: the button already has the full name. */}
                  <span aria-hidden className={cn('pointer-events-none absolute z-20 hidden w-72 rounded-xl border border-line bg-surface p-3 text-left shadow-card group-focus-within:block group-hover:block', m.index < 3 ? 'top-full mt-2' : 'bottom-full mb-2', view === 'chat' && m.speaker === 'operator' ? 'right-0' : 'left-0')}>
                    <span className="flex items-center justify-between gap-2 text-sm font-medium text-ink">
                      <span>{t.id} {t.title}</span>
                      <span className="shrink-0 rounded-full bg-fill px-2 text-xs">{t.label}</span>
                    </span>
                    <span className="mt-1 line-clamp-4 block text-xs leading-4 text-muted">{t.explanation}</span>
                  </span>
                </span>
              ))}
            </span>
          );
          const meta = (
            <>
              {m.timestamp} · #{m.index}
              {gap && <span className="ml-2">· {gap.text}</span>}
            </>
          );

          if (view === 'chat') {
            const right = m.speaker === 'operator';
            return (
              <li key={m.index} id={`msg-${m.index}`} ref={setRef} tabIndex={-1} data-cited={isCited || undefined} className={cn('flex flex-col outline-none', right ? 'items-end' : system ? 'items-center' : 'items-start')}>
                <span className={cn('mb-1 flex gap-2 text-xs tabular-nums text-muted', right && 'flex-row-reverse')}>
                  {!system && <span className={cn('font-medium', NAME[m.speaker])}>{SPEAKER_LABEL[m.speaker]}</span>}
                  <span>{meta}</span>
                </span>
                <span className={cn('block max-w-[85%] whitespace-pre-wrap break-words px-4 py-3 text-base sm:max-w-[72%]', BUBBLE[m.speaker], isCited && 'ring-2 ring-brand', inChecked && !isCited && 'ring-1 ring-line-strong')}>{m.text}</span>
                {tagRow}
              </li>
            );
          }

          return (
            <li
              key={m.index}
              id={`msg-${m.index}`}
              ref={setRef}
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
                <span className="block text-xs tabular-nums text-muted">{meta}</span>
              </span>
              <span className="min-w-0">
                <span className={cn('block whitespace-pre-wrap break-words', system ? 'text-sm italic' : 'text-base')}>{m.text}</span>
                {tagRow}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
