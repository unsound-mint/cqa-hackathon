import { useEffect, useState } from 'react';

/** Bars across the call bar: enough for detail at 1000+ px, cheap to draw as one SVG path. */
export const BUCKETS = 480;
/** Decoding at 8 kHz keeps a 10-minute call near 20 MB of samples (speech needs nothing more for a shape). */
const RATE = 8000;
const cache = new Map<string, Promise<number[] | null>>();

/**
 * Peak amplitude per bucket (0..1) of a recording, decoded in the browser and cached per source for the session.
 * Null when it cannot be decoded (no Web Audio, a host without CORS, a broken file): the bar then shows speaker bands
 * only. Recordings come from our own API (stored copies), so the fetch is same-origin.
 */
export function peaksOf(src: string): Promise<number[] | null> {
  const hit = cache.get(src);
  if (hit) return hit;
  const job = (async () => {
    const Offline = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
    if (!Offline) return null;
    try {
      const res = await fetch(src);
      if (!res.ok) return null;
      const audio = await new Offline(1, 1, RATE).decodeAudioData(await res.arrayBuffer());
      const data = audio.getChannelData(0);
      const size = Math.max(1, Math.floor(data.length / BUCKETS));
      const peaks: number[] = [];
      for (let b = 0; b < BUCKETS; b++) {
        let max = 0;
        for (let i = b * size, end = Math.min(data.length, i + size); i < end; i++) {
          const v = Math.abs(data[i]!);
          if (v > max) max = v;
        }
        peaks.push(max);
      }
      const top = Math.max(...peaks) || 1;
      return peaks.map((p) => p / top);
    } catch {
      return null;
    }
  })();
  cache.set(src, job);
  return job;
}

export function usePeaks(src: string | null): number[] | null {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    setPeaks(null);
    if (!src) return;
    let live = true;
    void peaksOf(src).then((p) => live && setPeaks(p));
    return () => {
      live = false;
    };
  }, [src]);
  return peaks;
}
