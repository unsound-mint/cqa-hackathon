import { scoreEvaluation, type Appeal, type ChecklistVersion, type Criterion, type CriterionResult, type CriterionValue, type DecideAppealInput, type Evaluation } from '@cqa/contracts';
import { CheckCircle2, Gavel, MessageSquareWarning, PencilLine } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/error-note';
import { cn } from '@/lib/utils';
import { earnedPoints, formatScore, outcome } from '@/lib/present';

/** Correction input for one criterion, the shape `CqaApi.overrideCriterion` takes minus the ids. */
export type Correction = { reason: string; value: CriterionValue | null; isNA: boolean };

const STATUS = {
  pending: { label: 'На рассмотрении', tone: 'warn' },
  upheld: { label: 'Оценка ИИ оставлена', tone: 'neutral' },
  overridden: { label: 'Оценка изменена', tone: 'neutral' },
} as const;
const statusOf = (a: Appeal) => (a.kind === 'correction' ? { label: 'Исправление проверяющего', tone: 'neutral' as const } : STATUS[a.status]);

const fmt = (iso: string) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

type Option = { key: string; label: string; value: CriterionValue | null; isNA: boolean };
const probe = (criterionId: string, value: CriterionValue | null, isNA: boolean): CriterionResult => ({ criterionId, value, isNA, explanation: '', evidence: [] });

/** Selectable answers of a criterion, from its configuration (never its id), labelled with the points each one gives. */
function options(c: Criterion | undefined): Option[] {
  if (!c) return [];
  const base = c.allowedValues.map((v, i) => {
    const answer = outcome(c, probe(c.id, v, false)).label;
    const pts = earnedPoints(c, probe(c.id, v, false));
    const label = pts === null ? answer : typeof v === 'number' ? `Ступень ${v} · ${formatScore(pts)} из ${c.weight}` : `${answer} · ${formatScore(pts)} из ${c.weight}`;
    return { key: `v${i}`, label, value: v as CriterionValue, isNA: false };
  });
  return c.allowNA ? [...base, { key: 'na', label: c.weight > 0 ? 'N/A · не учитывается' : 'N/A', value: null, isNA: true }] : base;
}
const isCurrent = (o: Option, r: CriterionResult | undefined) => !!r && (o.isNA ? r.isNA : !r.isNA && r.value === o.value);

/** Total of the dialog if this criterion took `o`, computed by the same scorer the server uses. */
function preview(evaluation: Evaluation, checklist: ChecklistVersion | undefined, criterionId: string, o: Option | undefined) {
  if (!o || !checklist) return null;
  try {
    const next = evaluation.finalResults.map((r) => (r.criterionId === criterionId ? { ...r, value: o.value, isNA: o.isNA } : r));
    return scoreEvaluation(checklist, next);
  } catch {
    return null;
  }
}

function AnswerPicker({ name, opts, current, picked, onPick }: { name: string; opts: Option[]; current: CriterionResult | undefined; picked: string; onPick: (k: string) => void }) {
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 text-xs font-medium">Новый ответ</legend>
      {opts.map((o) => {
        const now = isCurrent(o, current);
        return (
          <label key={o.key} className={cn('flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm', picked === o.key ? 'bg-brand-soft' : 'hover:bg-fill', now && 'text-muted')}>
            <input type="radio" name={name} checked={picked === o.key} disabled={now} onChange={() => onPick(o.key)} className="size-4 accent-brand" />
            <span className="tabular-nums">{o.label}</span>
            {now && <span className="ml-auto text-xs">сейчас</span>}
          </label>
        );
      })}
    </fieldset>
  );
}

function TotalPreview({ evaluation, next }: { evaluation: Evaluation; next: ReturnType<typeof preview> }) {
  if (!next) return null;
  const flag = next.seriousViolation !== evaluation.seriousViolation ? (next.seriousViolation ? ' · появится грубое нарушение' : ' · грубое нарушение снимется') : '';
  return (
    <p className="text-sm" aria-live="polite">
      Итог диалога: <span className="tabular-nums">{formatScore(evaluation.finalTotal)}</span> → <strong className="tabular-nums">{formatScore(next.total)}</strong>
      {flag && <span className="text-danger">{flag}</span>}
    </p>
  );
}

/** A form box; `dirty` marks it so the review shortcuts (digits, J/K/N, Esc) never fire over unsent text. */
function Box({ id, label, dirty, onSubmit, children }: { id?: string; label: string; dirty: boolean; onSubmit: (e: FormEvent) => void; children: ReactNode }) {
  return (
    <form id={id} aria-label={label} data-draft={dirty ? 'dirty' : undefined} onSubmit={onSubmit} className="space-y-3 rounded-xl border border-line-strong bg-surface p-4">
      {children}
    </form>
  );
}

type Props = {
  evaluation: Evaluation;
  checklist: ChecklistVersion | undefined;
  criterionId: string;
  criterion: Criterion | undefined;
  appeals: Appeal[];
  onCreate: (criterionId: string, comment: string) => Promise<void>;
  onDecide: (input: DecideAppealInput) => Promise<void>;
  onCorrect: (criterionId: string, c: Correction) => Promise<void>;
};

/**
 * What a reviewer can do with one criterion: correct it directly, or file an appeal (the operator's dispute path);
 * decide a pending appeal; and see the history of earlier decisions. The original AI answer is always kept.
 */
export function ReviewBox({ evaluation, checklist, criterionId, criterion, appeals, onCreate, onDecide, onCorrect }: Props) {
  const mine = appeals.filter((a) => a.criterionId === criterionId);
  const pending = mine.find((a) => a.status === 'pending');
  const history = mine.filter((a) => a.status !== 'pending').reverse();
  const current = evaluation.finalResults.find((r) => r.criterionId === criterionId);
  const opts = options(criterion);
  const id = `${evaluation.id}-${criterionId}`;

  const [mode, setMode] = useState<'idle' | 'correct' | 'appeal'>('idle');
  const [action, setAction] = useState<'uphold' | 'override' | null>(null);
  const [answer, setAnswer] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const picked = opts.find((o) => o.key === answer);
  /** A form opened from the row's buttons usually starts below the fold: bring it into view. */
  useEffect(() => {
    if (mode === 'idle') return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(`form-${id}`)?.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [mode, id]);
  const next = preview(evaluation, checklist, criterionId, picked);

  const reset = () => {
    setMode('idle');
    setAction(null);
    setAnswer('');
    setText('');
    setError(null);
  };
  const run = async (f: () => Promise<void>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      reset();
      setDone(message);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const savedTotal = (o: Option | undefined) => {
    const n = preview(evaluation, checklist, criterionId, o);
    return n ? `Сохранено. Итог диалога: ${formatScore(n.total)}.` : 'Сохранено.';
  };

  return (
    <div className="space-y-3">
      {done && !pending && mode === 'idle' && (
        <p role="status" className="flex items-center gap-2 text-sm text-accent"><CheckCircle2 aria-hidden className="size-4" />{done}</p>
      )}

      {pending && (
        <Box
          label={`Решение по апелляции, критерий ${criterionId}`}
          dirty={!!text.trim() || action !== null}
          onSubmit={(e) => {
            e.preventDefault();
            if (!action) return setError('Выберите решение');
            if (action === 'override' && !picked) return setError('Выберите новый ответ');
            void run(() => onDecide({ appealId: pending.id, action, reason: text.trim(), ...(action === 'override' && picked ? { value: picked.value, isNA: picked.isNA } : {}) }), action === 'override' ? savedTotal(picked) : 'Сохранено: оценка ИИ оставлена.');
          }}
        >
          <div>
            <p className="flex items-center gap-2 text-sm font-medium"><Gavel aria-hidden className="size-4 text-accent" />Апелляция ждёт решения</p>
            <p className="mt-1 max-w-[65ch] text-sm">{pending.comment}</p>
            <p className="mt-1 text-xs text-muted">Подана {fmt(pending.createdAt)}</p>
          </div>
          <div role="radiogroup" aria-label="Решение" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <label className="flex min-h-10 items-center gap-2"><input type="radio" name={`act-${id}`} checked={action === 'uphold'} onChange={() => setAction('uphold')} className="size-4 accent-brand" />Оставить оценку ИИ</label>
            <label className="flex min-h-10 items-center gap-2"><input type="radio" name={`act-${id}`} checked={action === 'override'} onChange={() => setAction('override')} className="size-4 accent-brand" />Изменить оценку</label>
          </div>
          {action === 'override' && (
            <>
              <AnswerPicker name={`val-${id}`} opts={opts} current={current} picked={answer} onPick={setAnswer} />
              <TotalPreview evaluation={evaluation} next={next} />
            </>
          )}
          <Field id={`why-${id}`} label="Обоснование решения" hint="Его увидят оператор и следующий проверяющий.">
            <Textarea id={`why-${id}`} value={text} onChange={(e) => setText(e.target.value)} required />
          </Field>
          <Button type="submit" variant="primary" size="sm" disabled={busy || !action || !text.trim() || (action === 'override' && !picked)}>{busy ? 'Сохранение…' : 'Принять решение'}</Button>
        </Box>
      )}

      {!pending && mode === 'idle' && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => { setDone(null); setMode('correct'); }}><PencilLine aria-hidden className="size-4" />Изменить оценку</Button>
          <Button variant="ghost" size="sm" onClick={() => { setDone(null); setMode('appeal'); }}><MessageSquareWarning aria-hidden className="size-4" />Оспорить</Button>
        </div>
      )}

      {!pending && mode === 'correct' && (
        <Box
          id={`form-${id}`}
          label={`Исправление оценки, критерий ${criterionId}`}
          dirty={!!text.trim() || !!answer}
          onSubmit={(e) => {
            e.preventDefault();
            if (!picked) return setError('Выберите новый ответ');
            void run(() => onCorrect(criterionId, { reason: text.trim(), value: picked.value, isNA: picked.isNA }), savedTotal(picked));
          }}
        >
          <AnswerPicker name={`fix-${id}`} opts={opts} current={current} picked={answer} onPick={setAnswer} />
          <TotalPreview evaluation={evaluation} next={next} />
          <Field id={`fixwhy-${id}`} label="Почему оценка другая" hint="Исходный ответ ИИ сохранится рядом с вашим.">
            <Textarea id={`fixwhy-${id}`} value={text} onChange={(e) => setText(e.target.value)} required />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={busy || !picked || !text.trim()}>{busy ? 'Сохранение…' : 'Сохранить оценку'}</Button>
            <Button type="button" size="sm" onClick={reset}>Отмена</Button>
          </div>
        </Box>
      )}

      {!pending && mode === 'appeal' && (
        <Box
          id={`form-${id}`}
          label={`Апелляция, критерий ${criterionId}`}
          dirty={!!text.trim()}
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => onCreate(criterionId, text.trim()), 'Апелляция подана: она в очереди на странице «Апелляции».');
          }}
        >
          <Field id={`cmt-${id}`} label="Почему вы не согласны с оценкой?" hint="Решение примет проверяющий; до решения балл не меняется.">
            <Textarea id={`cmt-${id}`} value={text} onChange={(e) => setText(e.target.value)} required />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={busy || !text.trim()}>{busy ? 'Отправка…' : 'Отправить апелляцию'}</Button>
            <Button type="button" size="sm" onClick={reset}>Отмена</Button>
          </div>
        </Box>
      )}

      <ErrorNote error={error} />

      {history.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer select-none text-xs text-muted hover:text-ink">История решений ({history.length})</summary>
          <ol className="mt-2 space-y-2">
            {history.map((a) => (
              <li key={a.id} className="rounded-xl bg-canvas px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusOf(a).tone}>{statusOf(a).label}</Badge>
                  <span className="text-xs text-muted">{a.kind === 'correction' ? '' : `Подана ${fmt(a.createdAt)} · `}решение {a.decidedAt ? fmt(a.decidedAt) : '—'}</span>
                </div>
                {a.comment && <p className="mt-1"><span className="font-medium">Возражение:</span> {a.comment}</p>}
                {a.reviewerReason && <p className="mt-1"><span className="font-medium">Обоснование:</span> {a.reviewerReason}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
