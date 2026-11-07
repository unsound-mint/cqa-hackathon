import { useRef } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  /** What it resizes, for screen readers ("Ширина очереди"). */
  label: string;
  /** Current width (px) of the pane it resizes; read when a drag or key press starts. */
  measure: () => number;
  min: number;
  max: number;
  onChange: (px: number) => void;
  /** Double-click (or Enter): back to the default width. */
  onReset: () => void;
  /** The pane is to the right of the handle: dragging left makes it wider. */
  invert?: boolean;
  className?: string;
};

const STEP = 16;

/**
 * A vertical pane divider (WAI-ARIA window splitter): drag with the pointer, or focus it and use ←/→ (16 px),
 * Home/End (min/max) and Enter or double-click to reset. It sits in the 16 px gap between cards and shows a faint grip,
 * stronger on hover and focus.
 */
export function Splitter({ label, measure, min, max, onChange, onReset, invert, className }: Props) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const clamp = (px: number) => Math.round(Math.min(max, Math.max(min, px)));
  const now = measure();

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(now)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      tabIndex={0}
      title="Потяните, чтобы изменить ширину; двойной щелчок вернёт исходную"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: measure() };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const delta = e.clientX - d.x;
        onChange(clamp(d.w + (invert ? -delta : delta)));
      }}
      onPointerUp={(e) => {
        drag.current = null;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const w = measure();
        const grow = invert ? 'ArrowLeft' : 'ArrowRight';
        const shrink = invert ? 'ArrowRight' : 'ArrowLeft';
        if (e.key === grow) onChange(clamp(w + STEP));
        else if (e.key === shrink) onChange(clamp(w - STEP));
        else if (e.key === 'Home') onChange(clamp(min));
        else if (e.key === 'End') onChange(clamp(max));
        else if (e.key === 'Enter') onReset();
        else return;
        e.preventDefault();
      }}
      className={cn('group relative flex cursor-col-resize touch-none items-center justify-center outline-none', className)}
    >
      <span aria-hidden className="h-12 w-1 rounded-full bg-line-strong opacity-40 transition-opacity group-hover:opacity-100 group-focus-visible:bg-accent group-focus-visible:opacity-100" />
    </div>
  );
}
