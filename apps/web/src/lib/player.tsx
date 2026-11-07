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

export type Band = { index: number; speaker: Conversation['transcript'][number]['speaker']; from: number; to: number | null };
export type CallMap = {
  /** Recorded messages on the recording's own timeline (seconds), each until the next one starts (`to` null: to the end). */
  bands: Band[];
  /** Places where the recording was paused and later resumed: the cut is invisible in the audio, so it is marked. */
  cuts: { at: number; seconds: number }[];
  /** Recording seconds -> conversation clock seconds (what the chat shows). */
  toClock: (rec: number) => number;
  /** The message being spoken at a recording position (the last recorded message started at or before it). */
  messageAt: (rec: number) => number | null;
};

/** The whole call laid onto the recording: what the call bar draws and how a click on it maps back to the chat. */
export function callMap(conversation: Conversation): CallMap {
  const tl = timelineOf(conversation);
  const starts = conversation.transcript
    .map((m, i) => ({ i, speaker: m.speaker, rec: m.speaker === 'system' ? null : recordingPosition(conversation, i) }))
    .filter((x): x is { i: number; speaker: Band['speaker']; rec: number } => x.rec !== null);
  const bands = starts.map((x, k) => {
    const later = starts.slice(k + 1).find((y) => y.rec >= x.rec + 1);
    return { index: x.i, speaker: x.speaker, from: x.rec, to: later ? later.rec : null };
  });
  const cuts = tl.pauses.filter((p) => Number.isFinite(p.to)).map((p) => ({ at: toRecordingClamped(tl, p.from), seconds: p.to - p.from }));
  const sorted = [...tl.pauses].sort((x, y) => x.from - y.from);
  return {
    bands,
    cuts,
    toClock: (rec) => {
      let wall = rec + tl.start;
      for (const p of sorted) {
        if (p.from <= wall && Number.isFinite(p.to)) wall += p.to - p.from;
        else break;
      }
      return wall;
    },
    messageAt: (rec) => {
      let hit: number | null = null;
      for (const b of bands) if (b.from <= rec + 0.05) hit = b.index;
      return hit;
    },
  };
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
  /** After a failed load: forget the failure and load the recording again (the server or link may be back). */
  retry: () => void;
  /** The transcript's <audio> element registers itself here. */
  register: (el: HTMLAudioElement | null) => void;
  /** Message being spoken at the playhead while the recording plays (null when paused or between calls). */
  speaking: number | null;
  /** Free play/pause of the whole recording (the call bar's button). */
  toggle: () => void;
  /** Moves the playhead to a recording position (seconds), keeping play/pause as it is. */
  seekRecording: (sec: number) => void;
  map: CallMap | null;
};

/** Playhead state, in its own context: it changes several times a second, and only the call bar needs it. */
export type Clock = { time: number; duration: number; paused: boolean };
const ClockCtx = createContext<Clock>({ time: 0, duration: 0, paused: true });
export const usePlayerClock = () => useContext(ClockCtx);

const Ctx = createContext<Player>({ available: false, failed: false, playing: null, playFragments: () => {}, stop: () => {}, seekTo: () => {}, retry: () => {}, register: () => {}, speaking: null, toggle: () => {}, seekRecording: () => {}, map: null });
export const usePlayer = () => useContext(Ctx);

/** One player per open conversation, shared by the transcript (which owns the <audio>) and the verdict panel. */
export function PlayerProvider({ conversation, children }: { conversation: Conversation | undefined; children: ReactNode }) {
  const el = useRef<HTMLAudioElement | null>(null);
  const queue = useRef<Segment[]>([]);
  const current = useRef<Segment | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [clock, setClock] = useState<Clock>({ time: 0, duration: 0, paused: true });
  const [speaking, setSpeaking] = useState<number | null>(null);
  const map = useMemo(() => (conversation?.audioUrl ? callMap(conversation) : null), [conversation]);
  const mapRef = useRef(map);
  mapRef.current = map;
  /** Clock for the bar; the spoken message only when it changes, so the transcript re-renders per message, not per tick. */
  const onClock = useCallback(() => {
    const a = el.current;
    if (!a) return;
    const duration = Number.isFinite(a.duration) ? a.duration : 0;
    setClock((c) => (c.time === a.currentTime && c.duration === duration && c.paused === a.paused ? c : { time: a.currentTime, duration, paused: a.paused }));
    const now = a.paused ? null : mapRef.current?.messageAt(a.currentTime) ?? null;
    setSpeaking((s) => (s === now ? s : now));
  }, []);
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

  const CLOCK_EVENTS = ['timeupdate', 'play', 'pause', 'seeked', 'durationchange', 'loadedmetadata', 'ended'] as const;
  const register = useCallback((a: HTMLAudioElement | null) => {
    if (el.current) {
      for (const ev of CLOCK_EVENTS) el.current.removeEventListener(ev, onClock);
      el.current.removeEventListener('timeupdate', onTime);
      el.current.removeEventListener('pause', onPause);
      el.current.removeEventListener('ended', clear);
      el.current.removeEventListener('error', onError);
    }
    el.current = a;
    if (a) {
      for (const ev of CLOCK_EVENTS) a.addEventListener(ev, onClock);
      a.addEventListener('timeupdate', onTime);
      a.addEventListener('pause', onPause);
      a.addEventListener('ended', clear);
      a.addEventListener('error', onError);
    }
  }, [onTime, onPause, clear, onError, onClock]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setFailed(false);
    setClock({ time: 0, duration: 0, paused: true });
    setSpeaking(null);
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
    retry: () => {
      setFailed(false);
      try {
        el.current?.load();
      } catch {
        /* the next play() loads it anyway */
      }
    },
    register,
    speaking,
    map,
    toggle: () => {
      const a = el.current;
      if (!a) return;
      clear(); // free listening: no fragment end
      if (a.paused) void a.play()?.catch(() => {});
      else a.pause();
    },
    seekRecording: (sec) => {
      const a = el.current;
      if (!a) return;
      clear();
      try {
        a.currentTime = Math.max(0, sec);
      } catch {
        /* media not ready */
      }
    },
  }), [conversation, playing, failed, start, clear, register, speaking, map]);

  return (
    <Ctx.Provider value={value}>
      <ClockCtx.Provider value={clock}>{children}</ClockCtx.Provider>
    </Ctx.Provider>
  );
}
