import type { ChecklistVersion, Criterion, CriterionResult, Speaker } from '@cqa/contracts';

export type Tone = 'neutral' | 'success' | 'danger' | 'warn';

export const SPEAKER_LABEL: Record<Speaker, string> = { client: 'Клиент', operator: 'Оператор', bot: 'Бот', system: 'Система' };

export const SOURCE_LABEL = { rule: 'Правило', hybrid: 'Правило + модель', model: 'Модель' } as const;
export const CONFIDENCE_LABEL = { high: 'высокая', medium: 'средняя', low: 'низкая' } as const;

/** Outcome text and tone for one criterion result. No criterion ids: everything comes from the checklist config. */
export function outcome(criterion: Criterion | undefined, r: CriterionResult): { label: string; tone: Tone } {
  if (r.isNA) return { label: 'N/A', tone: 'neutral' };
  const v = r.value;
  if (criterion?.criticalFlag) return v === true ? { label: 'Нарушение выявлено', tone: 'danger' } : { label: 'Не выявлено', tone: 'success' };
  if (typeof v === 'boolean') return v ? { label: 'Да', tone: 'success' } : { label: 'Нет', tone: 'danger' };
  if (typeof v === 'number') {
    const max = Math.max(...(criterion?.allowedValues.filter((x): x is number => typeof x === 'number') ?? [v]));
    const ratio = max > 0 ? v / max : 0;
    return { label: `${v} из ${max}`, tone: ratio >= 0.75 ? 'success' : ratio >= 0.4 ? 'warn' : 'danger' };
  }
  return { label: String(v), tone: 'neutral' };
}

export const sameResult = (a: CriterionResult | undefined, b: CriterionResult | undefined) => !!a && !!b && a.isNA === b.isNA && a.value === b.value;

export const criterionById = (checklist: ChecklistVersion | undefined) => (id: string) => checklist?.criteria.find((c) => c.id === id);

/** "12.5" -> "12,5": the UI is Russian. */
export const formatScore = (n: number | null) => (n === null ? '—' : n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }));

/** Weighted points a criterion earned (null for N/A, flag-only and zero-weight criteria: they carry no points). */
export function earnedPoints(c: Criterion | undefined, r: CriterionResult): number | null {
  if (!c || r.isNA || c.criticalFlag || c.weight <= 0) return null;
  if (typeof r.value === 'boolean') return r.value ? c.weight : 0;
  if (typeof r.value === 'number') {
    const max = Math.max(...c.allowedValues.filter((x): x is number => typeof x === 'number'));
    return max > 0 ? Math.round((r.value / max) * c.weight * 100) / 100 : 0;
  }
  return null;
}

/** A result a human should look at: low model confidence. */
export const needsReview = (r: CriterionResult) => r.confidence === 'low';

/** Seconds for "MM:SS" or an ISO timestamp; null if unparseable. Timestamps are shown raw; this only measures gaps. */
export function toSeconds(ts: string): number | null {
  const mmss = /^(\d+):(\d{2})$/.exec(ts);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms / 1000;
}

/**
 * "пауза 45 с" for a silence of 30 seconds or more between two messages. Information only: the rubric states no
 * waiting threshold (the 3-minute first-reaction figure is an SLA and is not graded), so nothing here is colored as a breach.
 */
export function gapLabel(prev: string | undefined, cur: string): { text: string } | null {
  if (prev === undefined) return null;
  const a = toSeconds(prev);
  const b = toSeconds(cur);
  if (a === null || b === null || b - a < 30) return null;
  const s = Math.round(b - a);
  const m = Math.floor(s / 60);
  return { text: `пауза ${m ? `${m} мин${s % 60 ? ` ${s % 60} с` : ''}` : `${s} с`}` };
}
