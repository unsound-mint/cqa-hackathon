import type { Conversation } from '@cqa/contracts';
import { MessageSquareText, Pause, Play } from 'lucide-react';
import { memo, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { SPEAKER_LABEL, clock, type Tone } from '@/lib/present';
import { usePlayer, usePlayerClock, type CallMap } from '@/lib/player';
import { BUCKETS, usePeaks } from '@/lib/waveform';

export type Marker = { index: number; ids: string[]; tone: Tone; active: boolean };

type Props = {
  conversation: Conversation;
  src: string;
  /** Evidence on the call: the open criterion's cited messages, or every message behind a lost point. */
  markers: Marker[];
  /** Shows a message in the chat (scroll + flash), without touching the player. */
  onReveal: (index: number) => void;
};

/** Speaker colors match the chat: operator green (the graded party), client ink, bot receding. */
const SPEAKER_FILL = { operator: 'fill-accent', client: 'fill-ink', bot: 'fill-line-strong', system: 'fill-line-strong' } as const;
const MARK = { neutral: 'bg-fill text-muted', success: 'bg-brand-soft text-accent', danger: 'bg-danger text-canvas', warn: 'bg-warn text-canvas' } as const;
const H = 40;

/** The bars: drawn once per recording and map; progress is a clip on a copy, so the playhead does not redraw 480 bars. */
const Bars = memo(function Bars({ peaks, map, duration }: { peaks: number[] | null; map: CallMap; duration: number }) {
  if (!peaks) {
    // No waveform (yet): speaker bands alone still show who spoke when.
    return (
      <svg viewBox={`0 0 1000 ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
        {map.bands.map((b) => {
          const to = b.to ?? duration;
          return <rect key={b.index} x={(b.from / duration) * 1000} y={H / 2 - 4} width={Math.max(1, ((to - b.from) / duration) * 1000 - 2)} height={8} rx={2} className={SPEAKER_FILL[b.speaker]} />;
        })}
      </svg>
    );
  }
  return (
    <svg viewBox={`0 0 ${BUCKETS} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
      {peaks.map((p, b) => {
        const at = map.messageAt(((b + 0.5) / BUCKETS) * duration);
        const speaker = at === null ? 'system' : (map.bands.find((x) => x.index === at)?.speaker ?? 'system');
        const h = Math.max(1.5, p * (H - 4));
        return <rect key={b} x={b + 0.15} y={(H - h) / 2} width={0.7} height={h} rx={0.35} className={SPEAKER_FILL[speaker]} />;
      })}
    </svg>
  );
});

/**
 * The call bar above the chat: play/pause, the recording as a waveform colored by who speaks, evidence markers and
 * the places where recording was paused. Everything links to the chat: a click on the bar or a marker scrolls the chat
 * to the message spoken there (a marker also plays that fragment); "В чате" shows what is playing now. Times are on the
 * conversation clock the chat uses, not the recording's own, which skips paused stretches.
 */
export function CallTimeline({ conversation, src, markers, onReveal }: Props) {
  const player = usePlayer();
  const { time, duration: mediaDuration, paused } = usePlayerClock();
  const peaks = usePeaks(src);
  const track = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; rec: number } | null>(null);
  const map = player.map;
  // Before the media reports its length, the last message gives a fair estimate so markers can be placed at once.
  const duration = mediaDuration || (map ? Math.max(1, ...map.bands.map((b) => (b.to ?? b.from + 10))) : 1);
  const pct = (rec: number) => `${Math.min(100, Math.max(0, (rec / duration) * 100))}%`;
  const recAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration));
  };
  const bandOf = (index: number) => map?.bands.find((b) => b.index === index);
  /** A moment on the bar = the message spoken there: move the playhead to its start and show it in the chat. */
  const goTo = (rec: number) => {
    const at = map?.messageAt(rec);
    if (at === null || at === undefined) return player.seekRecording(rec);
    player.seekRecording(bandOf(at)!.from);
    onReveal(at);
  };
  const placed = useMemo(() => markers.map((m) => ({ ...m, band: map?.bands.find((b) => b.index === m.index) })).filter((m) => m.band), [markers, map]);
  if (!map) return null;

  const hoverAt = hover ? map.messageAt(hover.rec) : null;
  const hoverMsg = hoverAt !== null ? conversation.transcript[hoverAt] : undefined;
  const nowAt = map.messageAt(time);

  return (
    <div className="space-y-1">
      {/* Evidence markers sit above the bar so they never hide the waveform. */}
      {placed.length > 0 && <div className="relative ml-12 mr-24 h-6" aria-label="Доказательства на записи" role="group">
        {placed.map((m) => (
          <button
            key={m.index}
            type="button"
            onClick={() => {
              onReveal(m.index);
              player.playFragments([m.index]);
            }}
            title={`Сообщение #${m.index}: прослушать и показать в чате`}
            aria-label={`Критерии ${m.ids.join(', ')}: сообщение #${m.index}, прослушать и показать в чате`}
            style={{ left: pct(m.band!.from) }}
            className={cn('absolute top-0 h-6 min-w-6 -translate-x-1/2 rounded-full px-2 text-xs font-semibold tabular-nums shadow-card transition-transform hover:scale-110', MARK[m.tone], m.active && 'ring-2 ring-accent')}
          >
            {m.ids.join(' ')}
          </button>
        ))}
      </div>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={player.toggle}
          aria-label={paused ? 'Слушать запись' : 'Пауза'}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-[#0e151c] transition-colors hover:bg-[#09c04a]"
        >
          {paused ? <Play aria-hidden className="size-4 fill-current" /> : <Pause aria-hidden className="size-4 fill-current" />}
        </button>

        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label="Запись звонка"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${clock(map.toClock(time))}${nowAt !== null ? `, ${SPEAKER_LABEL[conversation.transcript[nowAt]!.speaker]}` : ''}`}
          onPointerDown={(e) => goTo(recAt(e.clientX))}
          onPointerMove={(e) => setHover({ x: e.clientX - track.current!.getBoundingClientRect().left, rec: recAt(e.clientX) })}
          onPointerLeave={() => setHover(null)}
          onKeyDown={(e) => {
            const step = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : null;
            if (step !== null) player.seekRecording(Math.min(duration, Math.max(0, time + step)));
            else if (e.key === 'Home') player.seekRecording(0);
            else if (e.key === 'Enter' && nowAt !== null) onReveal(nowAt);
            else return;
            e.preventDefault();
          }}
          className="relative h-10 min-w-0 flex-1 cursor-pointer touch-none rounded-lg bg-fill/60"
        >
          <div className="absolute inset-0 opacity-35">
            <Bars peaks={peaks} map={map} duration={duration} />
          </div>
          <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - (time / duration) * 100}% 0 0)` }}>
            <Bars peaks={peaks} map={map} duration={duration} />
          </div>
          {map.cuts.map((c) => (
            <span key={c.at} title={`Запись приостанавливалась на ${Math.round(c.seconds)} с`} style={{ left: pct(c.at) }} className="absolute inset-y-0 w-0 border-l-2 border-dashed border-warn" />
          ))}
          <span aria-hidden style={{ left: pct(time) }} className="pointer-events-none absolute -inset-y-1 w-0 -translate-x-1/2 border-l-2 border-ink" />
          {hover && hoverMsg && (
            <span style={{ left: hover.x }} className="pointer-events-none absolute bottom-full z-20 mb-8 w-64 -translate-x-1/2 rounded-xl border border-line bg-surface p-2 text-xs shadow-card">
              <span className="font-medium tabular-nums">{clock(map.toClock(hover.rec))}</span> · {SPEAKER_LABEL[hoverMsg.speaker]} · #{hoverMsg.index}
              <span className="mt-1 line-clamp-2 block text-muted">{hoverMsg.text}</span>
            </span>
          )}
        </div>

        <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted">
          {clock(map.toClock(time))} / {clock(map.toClock(duration))}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-12 text-xs text-muted">
        <span className="flex items-center gap-1"><span aria-hidden className="size-2 rounded-full bg-accent" />Оператор</span>
        <span className="flex items-center gap-1"><span aria-hidden className="size-2 rounded-full bg-ink" />Клиент</span>
        <span className="flex items-center gap-1"><span aria-hidden className="size-2 rounded-full bg-line-strong" />Бот</span>
        {map.cuts.length > 0 && <span className="flex items-center gap-1"><span aria-hidden className="h-3 w-0 border-l-2 border-dashed border-warn" />пауза записи</span>}
        {nowAt !== null && (
          <button type="button" onClick={() => onReveal(nowAt)} className="ml-auto inline-flex min-h-6 items-center gap-1 rounded-full px-2 text-ink hover:bg-fill">
            <MessageSquareText aria-hidden className="size-4" />В чате: #{nowAt}
          </button>
        )}
      </div>
    </div>
  );
}
