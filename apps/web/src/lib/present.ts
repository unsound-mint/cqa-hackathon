import type { Appeal, ChecklistVersion, Criterion, CriterionResult, Evaluation, Speaker } from '@cqa/contracts';

export type Tone = 'neutral' | 'success' | 'danger' | 'warn';

export const SPEAKER_LABEL: Record<Speaker, string> = { client: 'Клиент', operator: 'Оператор', bot: 'Бот', system: 'Система' };

export const SOURCE_LABEL = { rule: 'Правило', hybrid: 'Правило + модель', model: 'Модель', reviewer: 'Проверяющий' } as const;
export const CONFIDENCE_LABEL = { high: 'высокая', medium: 'средняя', low: 'низкая' } as const;

/**
 * Outcome text and tone for one criterion result in the criterion's own terms (scale step, Да/Нет). For data
 * (CSV export) and the override options; on screen use `grade`, which states points so one row never shows two
 * different "из" numbers. No criterion ids: everything comes from the checklist config.
 */
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

/**
 * What the reviewer sees for a result: points earned of the criterion's weight ("10,50 из 15") whenever the criterion
 * carries points, otherwise the outcome (flags, N/A, zero-weight and list criteria).
 */
export function grade(criterion: Criterion | undefined, r: CriterionResult): { label: string; tone: Tone } {
  const o = outcome(criterion, r);
  const pts = earnedPoints(criterion, r);
  if (pts === null || !criterion) return o;
  // Full marks only are 'success'; any loss is amber, nothing earned is red (DESIGN.md: amber for a partial score).
  return { label: `${formatScore(pts)} из ${criterion.weight}`, tone: pts >= criterion.weight ? 'success' : pts > 0 ? 'warn' : 'danger' };
}

export const sameResult = (a: CriterionResult | undefined, b: CriterionResult | undefined) => !!a && !!b && a.isNA === b.isNA && a.value === b.value;

export const criterionById = (checklist: ChecklistVersion | undefined) => (id: string) => checklist?.criteria.find((c) => c.id === id);

/** "12.5" -> "12,50", "100" -> "100": the UI is Russian; fractions always show two digits so columns of scores line up. */
export const formatScore = (n: number | null) => (n === null ? '—' : n.toLocaleString('ru-RU', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }));

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

/** Position in a call recording for a message: only "MM:SS" timestamps (offset from the start of the call) are trusted. */
export function offsetSeconds(ts: string | undefined): number | null {
  const m = ts ? /^(\d+):(\d{2})$/.exec(ts) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** A result that needs the reviewer: low confidence, a pending appeal, or a grade a person changed. */
export function isFlagged(r: CriterionResult, original: CriterionResult | undefined, pendingIds: Set<string>) {
  return needsReview(r) || pendingIds.has(r.criterionId) || !sameResult(original, r);
}

export type CriterionGroup = { id: string; title: string; rows: CriterionResult[] };

/**
 * The criterion rows exactly as the verdict panel lists them: grouped by checklist section (unsectioned last, under
 * "Прочее"), optionally only the flagged ones. The digit shortcuts read the same list, so "3" opens the third row shown.
 */
export function criterionGroups(evaluation: Evaluation, checklist: ChecklistVersion | undefined, appeals: Appeal[], onlyFlagged: boolean): CriterionGroup[] {
  const original = new Map(evaluation.originalResults.map((r) => [r.criterionId, r]));
  const pendingIds = new Set(appeals.filter((a) => a.status === 'pending').map((a) => a.criterionId));
  const flagged = evaluation.finalResults.filter((r) => isFlagged(r, original.get(r.criterionId), pendingIds));
  // With nothing flagged the filter has nothing to show (and its checkbox is hidden): list everything.
  const shown = onlyFlagged && flagged.length ? flagged : evaluation.finalResults;
  const sections = checklist?.sections ?? [];
  if (!sections.length) return shown.length ? [{ id: '_', title: '', rows: shown }] : [];
  const sectionOf = (r: CriterionResult) => checklist?.criteria.find((c) => c.id === r.criterionId)?.sectionId;
  return [
    ...sections.map((s) => ({ id: s.id, title: s.title, rows: shown.filter((r) => sectionOf(r) === s.id) })),
    { id: '_', title: 'Прочее', rows: shown.filter((r) => !sections.some((s) => s.id === sectionOf(r))) },
  ].filter((g) => g.rows.length);
}
