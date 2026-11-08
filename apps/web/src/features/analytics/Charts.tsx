import type { TimelineEvent } from '@cqa/contracts';
import type { TrendPoint } from '@/lib/analytics';
import { formatScore } from '@/lib/present';

/**
 * Weekly average as a line with the timeline's events marked on it. Decorative SVG: the same numbers are in the table
 * beside it (`aria-hidden`), so the chart adds shape, not facts.
 */
export function TrendChart({ points, events }: { points: TrendPoint[]; events: TimelineEvent[] }) {
  if (points.length < 2) return <p className="text-sm text-muted">Для графика нужны оценки минимум за две недели.</p>;
  const W = 640, H = 200, L = 32, B = 24, T = 8, R = 8;
  const t0 = Date.parse(points[0]!.week), t1 = Date.parse(points[points.length - 1]!.week);
  const span = Math.max(1, t1 - t0);
  const ys = points.flatMap((p) => (p.average === null ? [] : [p.average]));
  const lo = Math.max(0, Math.floor((Math.min(...ys) - 5) / 10) * 10), hi = Math.min(100, Math.ceil((Math.max(...ys) + 2) / 10) * 10);
  const x = (t: number) => L + ((t - t0) / span) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - T - B);
  const path = points.filter((p) => p.average !== null).map((p, i) => `${i ? 'L' : 'M'}${x(Date.parse(p.week)).toFixed(1)},${y(p.average!).toFixed(1)}`).join(' ');
  return (
    <svg aria-hidden viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-3xl">
      {[lo, (lo + hi) / 2, hi].map((v) => (
        <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-line" /><text x={L - 4} y={y(v) + 4} textAnchor="end" className="fill-muted text-xs">{formatScore(v)}</text></g>
      ))}
      {events.filter((e) => Date.parse(e.date) >= t0 && Date.parse(e.date) <= t1).map((e, i) => (
        <g key={e.id}><line x1={x(Date.parse(e.date))} x2={x(Date.parse(e.date))} y1={T} y2={H - B} strokeDasharray="4 4" className={e.kind === 'training' ? 'stroke-brand' : 'stroke-warn'} /><text x={x(Date.parse(e.date)) + 4} y={T + 12 + (i % 2) * 16} className="fill-ink text-xs">{e.title.slice(0, 26)}</text></g>
      ))}
      <path d={path} fill="none" strokeWidth={2} className="stroke-ink" />
      {points.map((p) => p.average !== null && <circle key={p.week} cx={x(Date.parse(p.week))} cy={y(p.average)} r={3} className="fill-ink" />)}
      <text x={L} y={H - 6} className="fill-muted text-xs">{points[0]!.week}</text>
      <text x={W - R} y={H - 6} textAnchor="end" className="fill-muted text-xs">{points[points.length - 1]!.week}</text>
    </svg>
  );
}

/** A share as a bar (0..1), decorative like the numbers it repeats. */
export function ShareBar({ value, tone = 'brand' }: { value: number | null; tone?: 'brand' | 'warn' | 'danger' }) {
  const fill = tone === 'danger' ? 'bg-danger' : tone === 'warn' ? 'bg-warn' : 'bg-brand';
  return (
    <span aria-hidden className="flex h-2 w-24 overflow-hidden rounded-full bg-fill">
      {value !== null && <span className={`block h-full ${fill}`} style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />}
    </span>
  );
}
