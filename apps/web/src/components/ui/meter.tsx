import { cn } from '@/lib/utils';

export type MeterTone = 'neutral' | 'warn' | 'danger';
/** `neutral` is an amount with no verdict (the queue's totals); amber and red follow DESIGN.md's colors. */
const FILL: Record<MeterTone, string> = { neutral: 'bg-muted/50', warn: 'bg-warn', danger: 'bg-danger' };

/**
 * A 4px bar that draws a score that is already written next to it as text: decorative (aria-hidden), so screen
 * readers hear the number once. Tone follows DESIGN.md: neutral unless a human should look (amber) or it is a
 * violation or nothing was earned (red).
 */
export function Meter({ value, max, tone = 'neutral', className }: { value: number; max: number; tone?: MeterTone; className?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span aria-hidden className={cn('block h-1 overflow-hidden rounded-full bg-fill', className)}>
      <span className={cn('meter-fill block h-full rounded-full', FILL[tone])} style={{ width: `${pct}%` }} />
    </span>
  );
}
