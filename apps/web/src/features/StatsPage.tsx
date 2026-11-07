import type { Actor, Appeal, ChecklistVersion, Conversation, Evaluation, Language } from '@cqa/contracts';
import { useMemo, useState, type ReactNode } from 'react';
import { Select } from '@/components/ui/field';
import { Segment } from '@/components/ui/segment';
import { formatScore } from '@/lib/present';
import { computeStats, type CriterionStat } from '@/lib/stats';
import { cn } from '@/lib/utils';

type Props = { conversations: Conversation[]; evaluations: Evaluation[]; checklists: ChecklistVersion[]; appeals: Appeal[]; identity: Actor };

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)} %` : '—');

function Tile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'danger' | 'warn' }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <p className="text-sm text-muted">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold leading-8 tabular-nums', tone === 'danger' && 'text-danger', tone === 'warn' && 'text-warn')}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

const SEGMENTS = [
  { key: 'full', label: 'Полный балл', fill: 'bg-brand' },
  { key: 'partial', label: 'Часть баллов', fill: 'bg-warn' },
  { key: 'zero', label: 'Ноль баллов', fill: 'bg-danger' },
  { key: 'raised', label: 'Нарушение выявлено', fill: 'bg-danger' },
  { key: 'na', label: 'N/A', fill: 'bg-muted/50' },
  { key: 'other', label: 'Без баллов', fill: 'bg-line-strong' },
] as const;

/** One bar of a criterion's outcomes. Decorative: the same numbers are in the row's text. */
function Distribution({ s }: { s: CriterionStat }) {
  return (
    <span aria-hidden className="flex h-2 w-full overflow-hidden rounded-full bg-fill">
      {SEGMENTS.map(({ key, fill }) => (s[key] > 0 ? <span key={key} className={cn('block h-full', fill)} style={{ width: `${(s[key] / s.total) * 100}%` }} /> : null))}
    </span>
  );
}

/** Overview of everything evaluated so far. Counts are about the current evaluation of each dialog. */
export function StatsPage({ conversations, evaluations, checklists, appeals, identity }: Props) {
  const staff = identity.role !== 'operator';
  const [language, setLanguage] = useState<Language | 'all'>('all');
  const [checklistId, setChecklistId] = useState<string | null>(null);
  const stats = useMemo(() => computeStats({ conversations, evaluations, checklists, appeals, language, checklistId }), [conversations, evaluations, checklists, appeals, language, checklistId]);
  const languages = useMemo(() => [...new Set(conversations.map((c) => c.language))].sort(), [conversations]);
  const rated = stats.criteria.filter((c) => c.earnedShare !== null);
  const worst = [...rated].sort((a, b) => a.earnedShare! - b.earnedShare!)[0];
  const decided = stats.appeals.upheld + stats.appeals.overridden;

  return (
    <section aria-label="Статистика" className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-6 overflow-auto p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold leading-8">Статистика</h1>
        <p className="max-w-prose text-sm text-muted">{staff ? 'Текущая оценка каждого диалога.' : 'Текущая оценка ваших диалогов.'} Цифры пересчитываются при смене чек-листа и после решений по апелляциям.</p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        {languages.length > 1 && (
          <div role="group" aria-label="Язык" className="inline-flex gap-1 rounded-full bg-fill p-1">
            <Segment pressed={language === 'all'} onClick={() => setLanguage('all')}>Все языки</Segment>
            {languages.map((l) => (
              <Segment key={l} pressed={language === l} onClick={() => setLanguage(l)}>{l}</Segment>
            ))}
          </div>
        )}
        {stats.versions.length > 1 && (
          <Select aria-label="Версия чек-листа" value={stats.checklist?.id ?? ''} onChange={(e) => setChecklistId(e.target.value)} className="max-w-xs">
            {stats.versions.map(({ checklist, used }) => (
              <option key={checklist.id} value={checklist.id}>{`Версия ${checklist.version} · ${checklist.title} (${used})`}</option>
            ))}
          </Select>
        )}
      </div>

      {stats.dialogs === 0 ? (
        <div className="rounded-card border border-line bg-surface p-6 text-sm text-muted">Диалогов с таким языком нет.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Tile label="Оценено диалогов" value={`${stats.evaluated} из ${stats.dialogs}`} hint={[stats.notEvaluated && `${stats.notEvaluated} не оценено`, stats.failed && `${stats.failed} с ошибкой`].filter(Boolean).join(', ') || undefined} />
            <Tile label="Средний итог" value={formatScore(stats.averageTotal === null ? null : Math.round(stats.averageTotal * 100) / 100)} hint={worst ? `Слабее всего: ${worst.criterion.id} ${worst.criterion.title}` : undefined} />
            <Tile label="Серьёзные нарушения" value={stats.seriousViolations} hint={stats.evaluated ? `${pct(stats.seriousViolations, stats.evaluated)} оценённых` : undefined} tone={stats.seriousViolations ? 'danger' : undefined} />
            <Tile label="Нужна проверка" value={stats.needReview} hint="Низкая уверенность хотя бы в одном критерии" tone={stats.needReview ? 'warn' : undefined} />
          </div>

          <div className="rounded-card border border-line bg-surface shadow-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2 p-4 pb-2">
              <h2 className="text-base font-semibold leading-6">Критерии{stats.checklist ? `: «${stats.checklist.title}», версия ${stats.checklist.version}` : ''}</h2>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Обозначения">
                {SEGMENTS.filter(({ key }) => stats.criteria.some((c) => c[key] > 0)).map(({ key, label, fill }) => (
                  <li key={key} className="inline-flex items-center gap-2"><span aria-hidden className={cn('size-2 rounded-full', fill)} />{label}</li>
                ))}
              </ul>
            </div>
            {stats.criteria.length === 0 ? (
              <p className="p-4 pt-2 text-sm text-muted">Пока нет ни одной завершённой оценки.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">Результаты по критериям</caption>
                  <thead className="text-xs text-muted shadow-[0_1px_0_var(--c-line)]">
                    <tr className="h-10 text-left">
                      <th scope="col" className="px-4 font-medium">Критерий</th>
                      <th scope="col" className="hidden w-48 px-4 font-medium sm:table-cell">Распределение</th>
                      <th scope="col" className="px-4 text-right font-medium">Баллов набрано</th>
                      <th scope="col" className="hidden px-4 text-right font-medium md:table-cell">Подробно</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {stats.criteria.map((s) => (
                      <tr key={s.criterion.id} className="align-middle">
                        <td className="px-4 py-3"><span className="tabular-nums text-muted">{s.criterion.id}</span> {s.criterion.title}</td>
                        <td className="hidden px-4 py-3 sm:table-cell">{s.total > 0 && <Distribution s={s} />}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{s.earnedShare === null ? <span className="text-muted">—</span> : pct(s.earnedShare, 1)}</td>
                        <td className="hidden px-4 py-3 text-right text-xs tabular-nums text-muted md:table-cell">
                          {SEGMENTS.filter(({ key }) => s[key] > 0).map(({ key, label }) => `${label}: ${s[key]}`).join(' · ') || 'нет данных'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {staff && stats.byOperator.some((o) => o.operator !== null) && (
            <div className="rounded-card border border-line bg-surface shadow-card">
              <h2 className="p-4 pb-2 text-base font-semibold leading-6">По операторам</h2>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">Результаты по операторам</caption>
                  <thead className="text-xs text-muted shadow-[0_1px_0_var(--c-line)]">
                    <tr className="h-10 text-left">
                      <th scope="col" className="px-4 font-medium">Оператор</th>
                      <th scope="col" className="px-4 text-right font-medium">Оценено</th>
                      <th scope="col" className="px-4 text-right font-medium">Средний итог</th>
                      <th scope="col" className="px-4 text-right font-medium">Нарушений</th>
                      <th scope="col" className="hidden px-4 text-right font-medium sm:table-cell">Проверено</th>
                      <th scope="col" className="hidden px-4 text-right font-medium md:table-cell">Апелляций</th>
                      <th scope="col" className="hidden px-4 text-right font-medium md:table-cell">Ответов ИИ изменено</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {stats.byOperator.map((o) => (
                      <tr key={o.operator ?? 'none'} className="h-10">
                        <th scope="row" className="px-4 text-left font-medium">{o.operator ?? <span className="font-normal text-muted">Без оператора</span>}</th>
                        <td className="px-4 text-right tabular-nums">{o.evaluated} из {o.dialogs}</td>
                        <td className="px-4 text-right tabular-nums">{formatScore(o.averageTotal === null ? null : Math.round(o.averageTotal * 100) / 100)}</td>
                        <td className="px-4 text-right tabular-nums">{o.seriousViolations}</td>
                        <td className="hidden px-4 text-right tabular-nums sm:table-cell">{o.reviewed} из {o.dialogs}</td>
                        <td className="hidden px-4 text-right tabular-nums md:table-cell">{o.appealsTotal}{o.appealsPending ? ` (ждут: ${o.appealsPending})` : ''}</td>
                        <td className="hidden px-4 text-right tabular-nums md:table-cell">{o.results ? pct(o.changed, o.results) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-card border border-line bg-surface p-4 shadow-card">
              <h2 className="text-base font-semibold leading-6">Апелляции и проверка</h2>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
                {staff && <><dt className="font-medium">Проверено диалогов</dt><dd className="text-right font-medium tabular-nums">{stats.review.reviewed} из {stats.dialogs}{stats.review.in_review > 0 ? ` · в работе ${stats.review.in_review}` : ''}</dd></>}
                <dt className="text-muted">На рассмотрении</dt><dd className="text-right tabular-nums">{stats.appeals.pending}</dd>
                <dt className="text-muted">Оценка ИИ оставлена</dt><dd className="text-right tabular-nums">{stats.appeals.upheld}</dd>
                <dt className="text-muted">Оценка изменена по апелляции</dt><dd className="text-right tabular-nums">{stats.appeals.overridden}</dd>
                <dt className="text-muted">Исправлено проверяющим напрямую</dt><dd className="text-right tabular-nums">{stats.appeals.corrections}</dd>
                <dt className="font-medium">Ответов ИИ изменено проверяющими</dt>
                <dd className="text-right font-medium tabular-nums">{stats.reviewedResults.changed} из {stats.reviewedResults.total} ({pct(stats.reviewedResults.changed, stats.reviewedResults.total)})</dd>
              </dl>
              {decided > 0 && <p className="mt-2 text-xs text-muted">Из решённых апелляций изменены {pct(stats.appeals.overridden, decided)}.</p>}
            </div>

            <div className="rounded-card border border-line bg-surface p-4 shadow-card">
              <h2 className="text-base font-semibold leading-6">По языкам</h2>
              <table className="mt-2 w-full border-collapse text-sm">
                <caption className="sr-only">Результаты по языкам</caption>
                <thead className="text-xs text-muted"><tr className="h-8 text-left"><th scope="col" className="font-medium">Язык</th><th scope="col" className="text-right font-medium">Оценено</th><th scope="col" className="text-right font-medium">Средний итог</th><th scope="col" className="text-right font-medium">Нарушений</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {stats.byLanguage.map((l) => (
                    <tr key={l.language} className="h-10">
                      <th scope="row" className="text-left font-medium">{l.language}</th>
                      <td className="text-right tabular-nums">{l.evaluated} из {l.dialogs}</td>
                      <td className="text-right tabular-nums">{formatScore(l.averageTotal === null ? null : Math.round(l.averageTotal * 100) / 100)}</td>
                      <td className="text-right tabular-nums">{l.seriousViolations}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
