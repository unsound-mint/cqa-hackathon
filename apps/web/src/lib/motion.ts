import { useEffect, useRef, useState } from 'react';

/** True when motion should be skipped: the user asked for less, or the environment cannot tell (tests, old browsers). */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Counts from 0 up to `target` once per `key` (a new dialog), for a visual copy of a number only: the accessible
 * text must carry the final value. CSS reduced-motion rules do not stop a JS loop, so this checks on its own.
 * A changed total under the same key (a reviewer's correction) shows at once, without replaying the count.
 */
export function useCountUp(target: number | null, key: string, ms = 700): number | null {
  const animate = target !== null && !prefersReducedMotion();
  const [shown, setShown] = useState(animate ? 0 : target);
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    // A key is used up only once there is a number to count (the evaluation may arrive after the dialog).
    if (target === null) {
      setShown(null);
      return;
    }
    const fresh = lastKey.current !== key;
    lastKey.current = key;
    if (!fresh || prefersReducedMotion()) {
      setShown(target);
      return;
    }
    let raf = 0;
    let done = false;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setShown(t < 1 ? target * (1 - (1 - t) ** 3) : target);
      if (t < 1) raf = requestAnimationFrame(tick);
      else done = true;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Interrupted (StrictMode's double effect, or a new total mid-count): the next run counts again.
      if (!done) lastKey.current = null;
    };
  }, [key, target, ms]);
  return shown;
}
