import { useEffect, useState } from 'react';

const matches = (q: string, fallback: () => boolean) => window.matchMedia?.(q).matches ?? fallback();

/** Tracks a CSS media query (min-width only is needed here; the fallback reads innerWidth for test environments). */
export function useMinWidth(px: number): boolean {
  const q = `(min-width: ${px}px)`;
  const read = () => matches(q, () => window.innerWidth >= px);
  const [on, setOn] = useState(read);
  useEffect(() => {
    const update = () => setOn(read());
    const mq = window.matchMedia?.(q);
    mq?.addEventListener?.('change', update);
    window.addEventListener('resize', update);
    return () => {
      mq?.removeEventListener?.('change', update);
      window.removeEventListener('resize', update);
    };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  return on;
}

/** True from 1536px: the width where the queue rail fits beside the transcript and the verdict panel. */
export const useWide = () => useMinWidth(1536);
/** True from 1280px (Tailwind `xl`): transcript and verdict side by side; below it they are tabs. */
export const useTwoPane = () => useMinWidth(1280);
