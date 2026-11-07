import { useEffect, useState } from 'react';

/** True from 1536px: the width where the queue rail fits beside the transcript and the verdict panel. */
const WIDE = '(min-width: 1536px)';
const isWide = () => window.matchMedia?.(WIDE).matches ?? window.innerWidth >= 1536;

export function useWide(): boolean {
  const [wide, setWide] = useState(isWide);
  useEffect(() => {
    const update = () => setWide(isWide());
    const mq = window.matchMedia?.(WIDE);
    mq?.addEventListener?.('change', update);
    window.addEventListener('resize', update);
    return () => {
      mq?.removeEventListener?.('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return wide;
}
