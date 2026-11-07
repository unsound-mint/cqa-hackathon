import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** One option of a quiet segmented switch (review states): a colored dot, not colored text, marks violations and review. */
export function Segment({ pressed, onClick, children, tone, className }: { pressed: boolean; onClick: () => void; children: ReactNode; tone?: 'danger' | 'warn'; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn('inline-flex h-8 items-center gap-2 rounded-full px-3 text-sm whitespace-nowrap transition-colors', pressed ? 'bg-surface font-medium text-ink shadow-card' : 'text-muted hover:text-ink', className)}
    >
      {tone && <span aria-hidden className={cn('size-2 shrink-0 rounded-full', tone === 'danger' ? 'bg-danger' : 'bg-warn')} />}
      {children}
    </button>
  );
}
