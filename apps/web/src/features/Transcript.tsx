import type { Conversation, Speaker } from '@cqa/contracts';
import { useEffect, useRef, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Bot, Headset, Play, Square, User } from 'lucide-react';
import { SPEAKER_LABEL, displayTime, gapLabel, type Tone } from '@/lib/present';
import { fragmentLabel, segmentOf, usePlayer } from '@/lib/player';
import { useApi } from '@/ApiContext';
import { prefersReducedMotion } from '@/lib/motion';
import { CallTimeline, type Marker } from './CallTimeline';

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
  /** Criteria that cite each message, shown as small numbered tags that open that criterion. */
  tags: ReadonlyMap<number, Tag[]>;
  onTag: (criterionId: string) => void;
  /** The open criterion, if any. */
  activeId: string | null;
  /** Title and queue controls of the dialog, rendered at the top of the card (replaces a separate title bar). */
  toolbar: ReactNode;
};

/** Tags are quiet tints; only the open criterion's tag is solid, so the eye lands on the evidence being discussed. */
const TAG = { neutral: 'bg-fill text-muted', success: 'bg-brand-soft text-accent', danger: 'bg-danger-soft text-danger', warn: 'bg-warn-soft text-warn' } as const;
const TAG_ACTIVE = { neutral: 'bg-ink text-canvas', success: 'bg-brand text-[#0e151c]', danger: 'bg-danger text-canvas', warn: 'bg-warn text-canvas' } as const;

/** Client on the left, operator (the graded party) on the right, bot dimmed, system as small centered notes. */
const BUBBLE: Record<Speaker, string> = {
  operator: 'rounded-2xl rounded-tr-sm bg-brand-soft',
  client: 'rounded-2xl rounded-tl-sm border border-line-strong bg-surface',
  bot: 'rounded-2xl rounded-tl-sm bg-fill text-muted',
  system: 'rounded-full bg-fill px-4 py-1 text-sm italic text-muted',
};
const NAME: Record<Speaker, string> = { operator: 'text-accent', client: 'text-ink', bot: 'text-muted', system: 'text-muted' };
/** A small avatar next to the name so the voices differ by more than a word: the bot is an automatic voice, not the client. */
const ICON = { operator: Headset, client: User, bot: Bot } as const;
const AVATAR = { operator: 'bg-brand-soft text-accent', client: 'bg-fill text-ink', bot: 'bg-fill text-muted' } as const;
/** Dots on the chat's time rail: the graded party is green, everyone else recedes. */
const DOT: Record<Speaker, string> = { operator: 'bg-brand', client: 'bg-muted', bot: 'bg-line-strong', system: 'bg-line-strong' };
const DOT_CITED = { neutral: 'bg-ink', success: 'bg-brand', danger: 'bg-danger', warn: 'bg-warn' } as const;

export function Transcript({ conversation, cited, checkedRange, focus, tags, onTag, activeId, toolbar }: Props) {
  const refs = useRef(new Map<number, HTMLLIElement>());
  const scroller = useRef<HTMLDivElement>(null);
  const player = usePlayer();
  const api = useApi();
  const src = api.audioSrc(conversation);
  const canPlay = !!src && player.available;

  /** Brings a message into view and flashes it (evidence links, the call bar, "В чате"). */
  const reveal = (index: number) => {
    const el = refs.current.get(index);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
    el.classList.remove('flash');
    void el.offsetWidth; // restart the animation on repeated clicks
    el.classList.add('flash');
  };
  useEffect(() => {
    if (!focus) return;
    reveal(focus.index);
    player.seekTo(focus.index); // evidence on a call: the player moves to that fragment without playing
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Opening a criterion brings its evidence into view, unless some of it is already on screen (a tag clicked on a
   * message must not throw the reader somewhere else).
   */
  useEffect(() => {
    const box = scroller.current;
    if (!activeId || !box || cited.size === 0) return;
    const view = box.getBoundingClientRect();
    const els = [...cited].sort((a, b) => a - b).map((i) => refs.current.get(i)).filter((el): el is HTMLLIElement => !!el);
    const visible = els.some((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > view.top && r.top < view.bottom;
    });
    if (!visible) els[0]?.scrollIntoView?.({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Spotlight: with a criterion open, everything it does not cite steps back (or, for an absence claim, everything outside the checked range). */
  const dimmed = (index: number) => {
    if (!activeId) return false;
    if (cited.size > 0) return !cited.has(index);
    return !!checkedRange && (index < checkedRange.from || index > checkedRange.to);
  };
  /** The time rail fills the margin beside a chat; a call already has its bar with the same moments, so it gets none. */
  const rail = conversation.channel !== 'voice call';

  /** Markers on the call bar: the open criterion's evidence, or (nothing open) every message behind a lost point. */
  const markers: Marker[] = [...tags]
    .map(([index, list]) => {
      const shown = activeId ? list.filter((t) => t.id === activeId) : list.filter((t) => t.tone === 'danger' || t.tone === 'warn');
      if (!shown.length) return null;
      const tone = shown.some((t) => t.tone === 'danger') ? 'danger' : shown[0]!.tone;
      return { index, ids: shown.map((t) => t.id), tone, active: !!activeId };
    })
    .filter((m): m is Marker => m !== null);

  return (
    <section aria-label="Транскрипт" className="flex h-full min-h-0 flex-col">
      <header className="space-y-3 border-b border-line px-6 py-4">
        {toolbar}
        {conversation.channel === 'voice call' && <Badge tone="warn">Распознанная речь: возможны ошибки в словах</Badge>}
        {src && <audio ref={player.register} preload="metadata" src={src} className="hidden" />}
        {src && !player.failed && <CallTimeline conversation={conversation} src={src} markers={markers} onReveal={reveal} />}
        {player.failed && conversation.audioUrl && (
          <p role="status" className="text-sm text-muted">
            Запись не загрузилась: ссылка могла устареть или сервер записи недоступен.{' '}
            <button type="button" onClick={player.retry} className="font-medium text-accent underline underline-offset-2">Повторить</button>
            {' или '}
            <a href={conversation.audioUrl} target="_blank" rel="noreferrer noopener" className="text-accent underline underline-offset-2">открыть запись у организатора</a>
          </p>
        )}
      </header>
      <div ref={scroller} className="@container min-h-0 flex-1 overflow-y-auto p-4">
      <ol start={0} className={cn('relative mx-auto w-full max-w-[44rem] space-y-4', rail && 'before:absolute before:-left-8 before:bottom-0 before:top-2 before:hidden before:w-px before:bg-line @[52rem]:before:block')}>
        {conversation.transcript.map((m, k) => {
          const isCited = cited.has(m.index);
          const inChecked = checkedRange && m.index >= checkedRange.from && m.index <= checkedRange.to;
          const mine = tags.get(m.index) ?? [];
          const system = m.speaker === 'system';
          const right = m.speaker === 'operator';
          const gap = gapLabel(conversation.transcript[k - 1]?.timestamp, m.timestamp);
          const seg = canPlay ? segmentOf(conversation, m.index) : null;
          const isPlaying = player.playing === m.index;
          const isSpeaking = !isPlaying && player.speaking === m.index;
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
              className={cn('relative flex flex-col outline-none transition-opacity duration-300', right ? 'items-end' : system ? 'items-center' : 'items-start', dimmed(m.index) && 'opacity-80 hover:opacity-100 focus-within:opacity-100')}
            >
              {rail && (
                <span
                  aria-hidden
                  className={cn('absolute -left-8 top-2 hidden -translate-x-1/2 rounded-full ring-4 ring-surface transition-all duration-300 @[52rem]:block', isCited ? cn('size-3', DOT_CITED[mine.find((t) => t.id === activeId)?.tone ?? 'success']) : cn('size-2', DOT[m.speaker]))}
                />
              )}
              <span className={cn('mb-1 flex gap-2 text-xs tabular-nums text-muted', right && 'flex-row-reverse')}>
                {!system && (
                  <span className={cn('inline-flex items-center gap-1 font-medium', NAME[m.speaker])}>
                    {(() => {
                      const k = m.speaker as keyof typeof ICON;
                      const Icon = ICON[k];
                      return <span aria-hidden className={cn('-my-1 grid size-6 place-items-center rounded-full', AVATAR[k])}><Icon className="size-4" /></span>;
                    })()}
                    {SPEAKER_LABEL[m.speaker]}
                  </span>
                )}
                <span title={m.timestamp}>
                  {displayTime(conversation, m.index)} · #{m.index}
                  {gap && <span className="ml-2">· {gap.text}</span>}
                </span>
                {seg && (
                  <button
                    type="button"
                    onClick={() => (isPlaying ? player.stop() : player.playFragments([m.index]))}
                    aria-label={isPlaying ? 'Остановить фрагмент' : `Прослушать фрагмент ${fragmentLabel(conversation, seg)}`}
                    title={isPlaying ? 'Остановить' : `Прослушать ${fragmentLabel(conversation, seg)}`}
                    className={cn('-my-1 grid size-6 place-items-center rounded-full', isPlaying ? 'bg-brand text-[#0e151c]' : 'hover:bg-fill hover:text-ink')}
                  >
                    {isPlaying ? <Square aria-hidden className="size-3 fill-current" /> : <Play aria-hidden className="size-4" />}
                  </button>
                )}
              </span>
              <span className={cn('block max-w-[85%] whitespace-pre-wrap break-words px-4 py-3 text-base sm:max-w-[80%]', BUBBLE[m.speaker], isCited && 'glow', inChecked && !isCited && 'ring-1 ring-line-strong', isPlaying && 'ring-2 ring-brand motion-safe:animate-pulse', isSpeaking && 'ring-2 ring-brand/60')}>{m.text}</span>
              {mine.length > 0 && (
                <span className={cn('mt-2 flex flex-wrap gap-1', right && 'justify-end', system && 'justify-center')}>
                  {mine.map((t) => (
                    <span key={t.id} className="group relative">
                      <button type="button" onClick={() => onTag(t.id)} aria-label={`Открыть критерий ${t.id}: ${t.title}, ${t.label}`} className={cn('h-6 min-w-8 rounded-full px-2 text-xs font-semibold tabular-nums', (activeId === t.id ? TAG_ACTIVE : TAG)[t.tone])}>
                        {t.id}
                      </button>
                      {/* Preview on hover or keyboard focus: which criterion, its verdict and the reason. Decorative: the button already has the full name. */}
                      <span aria-hidden className={cn('pointer-events-none absolute z-20 hidden w-72 rounded-xl border border-line bg-surface p-3 text-left shadow-card group-focus-within:block group-hover:block', m.index < 3 ? 'top-full mt-2' : 'bottom-full mb-2', right ? 'right-0' : 'left-0')}>
                        <span className="flex items-center justify-between gap-2 text-sm font-medium text-ink">
                          <span>{t.id} {t.title}</span>
                          <span className="shrink-0 rounded-full bg-fill px-2 text-xs">{t.label}</span>
                        </span>
                        <span className="mt-1 line-clamp-4 block text-xs leading-4 text-muted">{t.explanation}</span>
                      </span>
                    </span>
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      </div>
    </section>
  );
}
