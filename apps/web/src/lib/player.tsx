import type { Conversation } from '@cqa/contracts';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { clock, sinceStart } from './present';

/**
 * Seconds of lead-in before a message and of tail after the next one starts, so words at the edges are not cut.
 * Positions derived from clock times (real exports) get a longer lead-in: the recording may start a little late or early.
 */
const PRE = 1;
const PRE_DERIVED = 2;
const POST = 0.5;

export type Segment = { index: number; from: number; to: number | null; label: string };

/**
 * Recording events in the transcript ("Запись и транскрибирование запущены / приостановлены / возобновлены", the Kazakh
 * "Жазу және транскрипция басталды"): the recording starts with the first start event (or the first message) and skips
 * every paused stretch, so clock time and recording time drift apart by those amounts. Measured on the DEV calls: with
 * this mapping the last spoken message lands inside the recording on all five (without it, 6-29 s past the end).
 */
const REC = /запис|жазу|record/i;
const START = /запущен|начат|басталд|\bstart/i;
const PAUSE = /приостановлен|тоқтатыл|кідіртіл|\bpause/i;
const RESUME = /возобновлен|жалғастырыл|қайта|\bresume/i;

type Timeline = { start: number; pauses: { from: number; to: number }[] };
function timelineOf(conversation: Conversation): Timeline {
  let start: number | null = null;
  const pauses: { from: number; to: number }[] = [];
  let pausedAt: number | null = null;
  conversation.transcript.forEach((m, i) => {
    if (m.speaker !== 'system' || !REC.test(m.text)) return;
    const t = sinceStart(conversation, i)?.sec;
    if (t === undefined) return;
    if (PAUSE.test(m.text)) pausedAt ??= t;
    else if (RESUME.test(m.text)) {
      if (pausedAt !== null) pauses.push({ from: pausedAt, to: t });
      pausedAt = null;
    } else if (START.test(m.text)) start ??= t;
  });
  if (pausedAt !== null) pauses.push({ from: pausedAt, to: Number.POSITIVE_INFINITY });
  return { start: start ?? 0, pauses };
}
/** Clock seconds -> recording seconds; null when that moment was not recorded (before the start or while paused). */
function toRecording(tl: Timeline, wall: number): number | null {
  if (wall < tl.start - 0.5) return null;
  let skipped = 0;
  for (const p of tl.pauses) {
    if (wall >= p.from && wall < p.to) return null;
    if (wall >= p.to) skipped += p.to - p.from;
  }
  return Math.max(0, wall - tl.start - skipped);
}
/** Like toRecording, but a moment inside a pause maps to where the recording paused (for fragment ends). */
function toRecordingClamped(tl: Timeline, wall: number): number {
  const p = tl.pauses.find((x) => wall >= x.from && wall < x.to);
  return toRecording(tl, p ? p.from - 0.001 : Math.max(wall, tl.start)) ?? 0;
}

/**
 * The recording fragment of one message: from its moment to the next message at least a second later (repeated
 * timestamps share a fragment), or to the end of the call. Null for system events and for speech that was not recorded.
 * `label` uses the conversation clock shown in the transcript, so the numbers match what the reviewer reads.
 */
export function segmentOf(conversation: Conversation, index: number): Segment | null {
  const m = conversation.transcript[index];
  if (!m || m.speaker === 'system') return null;
  const at = sinceStart(conversation, index);
  if (at === null) return null;
  const tl = timelineOf(conversation);
  const rec = toRecording(tl, at.sec);
  if (rec === null) return null;
  const nextWall = conversation.transcript.slice(index + 1).map((_, k) => sinceStart(conversation, index + 1 + k)?.sec).find((s) => s !== undefined && s >= at.sec + 1);
  const to = nextWall === undefined ? null : toRecordingClamped(tl, nextWall) + POST;
  return { index, from: Math.max(0, rec - (at.derived ? PRE_DERIVED : PRE)), to, label: nextWall === undefined ? `с ${clock(at.sec)}` : `${clock(at.sec)}–${clock(nextWall)}` };
}

/** "01:02–01:10" for a fragment (conversation clock), "с 01:02" when it runs to the end. */
export function fragmentLabel(_conversation: Conversation, seg: Segment): string {
  return seg.label;
}

/** Recording position of a message (null if it was not recorded). */
export function recordingPosition(conversation: Conversation, index: number): number | null {
  const at = sinceStart(conversation, index);
  return at === null ? null : toRecording(timelineOf(conversation), at.sec);
}

type Player = {
  /** A recording exists and has not failed to load. */
  available: boolean;
  /** The recording could not be loaded (expired link, host down): fragment controls hide, the transcript says so. */
  failed: boolean;
  /** Message whose fragment is playing now, if any. */
  playing: number | null;
  /** Plays the fragments of these messages one after another (skips messages without one) and stops. */
  playFragments: (indices: number[]) => void;
  stop: () => void;
  /** Moves the player to a message without playing (evidence navigation). */
  seekTo: (index: number) => void;
  /** The transcript's <audio> element registers itself here. */
  register: (el: HTMLAudioElement | null) => void;
};

const Ctx = createContext<Player>({ available: false, failed: false, playing: null, playFragments: () => {}, stop: () => {}, seekTo: () => {}, register: () => {} });
export const usePlayer = () => useContext(Ctx);

/** One player per open conversation, shared by the transcript (which owns the <audio>) and the verdict panel. */
export function PlayerProvider({ conversation, children }: { conversation: Conversation | undefined; children: ReactNode }) {
  const el = useRef<HTMLAudioElement | null>(null);
  const queue = useRef<Segment[]>([]);
  const current = useRef<Segment | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => {
    queue.current = [];
    current.current = null;
    setPlaying(null);
    setFailed(true);
  }, []);

  const clear = useCallback(() => {
    queue.current = [];
    current.current = null;
    setPlaying(null);
  }, []);

  /** A bad position or a blocked play() never breaks the page: the player just stays where it is. */
  const start = useCallback((seg: Segment) => {
    const a = el.current;
    if (!a) return;
    current.current = seg;
    setPlaying(seg.index);
    // Position and play() in the same tick as the click: browsers only allow playback inside the user's gesture.
    // Before the media has loaded, the position set here is kept as the start position once it loads (preload="none").
    try {
      a.currentTime = seg.from;
      void a.play()?.catch(() => clear());
    } catch {
      clear();
    }
  }, [clear]);

  const next = useCallback(() => {
    const seg = queue.current.shift();
    if (seg) start(seg);
    else {
      el.current?.pause();
      clear();
    }
  }, [start, clear]);

  const onTime = useCallback(() => {
    const a = el.current;
    const seg = current.current;
    if (a && seg && seg.to !== null && a.currentTime >= seg.to) next();
  }, [next]);
  /** The reviewer paused or used the native controls: the fragment is over. */
  const onPause = useCallback(() => {
    if (current.current) clear();
  }, [clear]);

  const register = useCallback((a: HTMLAudioElement | null) => {
    if (el.current) {
      el.current.removeEventListener('timeupdate', onTime);
      el.current.removeEventListener('pause', onPause);
      el.current.removeEventListener('ended', clear);
      el.current.removeEventListener('error', onError);
    }
    el.current = a;
    if (a) {
      a.addEventListener('timeupdate', onTime);
      a.addEventListener('pause', onPause);
      a.addEventListener('ended', clear);
      a.addEventListener('error', onError);
    }
  }, [onTime, onPause, clear, onError]);

  useEffect(() => {
    setFailed(false);
    return clear;
  }, [conversation?.id, clear]);

  const value = useMemo<Player>(() => ({
    available: !!conversation?.audioUrl && !failed,
    failed,
    playing,
    playFragments: (indices) => {
      if (!conversation) return;
      // Messages with the same timestamp share one fragment: play it once.
      const segs = [...new Set(indices)].sort((x, y) => x - y).map((i) => segmentOf(conversation, i)).filter((s): s is Segment => s !== null)
        .filter((sg, k, all) => all.findIndex((o) => o.from === sg.from && o.to === sg.to) === k);
      if (!segs.length) return;
      queue.current = segs.slice(1);
      start(segs[0]!);
    },
    stop: () => {
      el.current?.pause();
      clear();
    },
    seekTo: (index) => {
      const pos = conversation ? recordingPosition(conversation, index) : null;
      const a = el.current;
      if (pos === null || !a) return;
      try {
        a.currentTime = pos;
      } catch {
        /* media not ready */
      }
    },
    register,
  }), [conversation, playing, failed, start, clear, register]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
