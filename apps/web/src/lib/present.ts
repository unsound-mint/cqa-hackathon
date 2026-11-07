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
