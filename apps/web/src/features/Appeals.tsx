import type { Appeal, Criterion, CriterionValue, DecideAppealInput } from '@cqa/contracts';
import { Gavel, MessageSquareWarning } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/field';

const STATUS = {
  pending: { label: 'На рассмотрении', tone: 'warn' },
  upheld: { label: 'Оценка ИИ оставлена', tone: 'neutral' },
  overridden: { label: 'Оценка изменена ревьюером', tone: 'success' },
} as const;

const fmt = (iso: string) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

/** One selectable answer of a criterion, derived from its configuration (never from its id). */
function options(c: Criterion | undefined): { key: string; label: string; value: CriterionValue | null; isNA: boolean }[] {
  if (!c) return [];
  const base = c.allowedValues.map((v, i) => ({ key: `v${i}`, label: typeof v === 'boolean' ? (c.criticalFlag ? (v ? 'Нарушение выявлено' : 'Не выявлено') : v ? 'Да' : 'Нет') : String(v), value: v as CriterionValue | null, isNA: false }));
  return c.allowNA ? [...base, { key: 'na', label: 'N/A', value: null, isNA: true }] : base;
}

type Props = {
  evaluationId: string;
  criterionId: string;
  criterion: Criterion | undefined;
  appeals: Appeal[];
  onCreate: (criterionId: string, comment: string) => Promise<void>;
  onDecide: (input: DecideAppealInput) => Promise<void>;
};

/** Appeal history of one criterion, the form to file a new one, and the reviewer decision form for a pending one. */
export function AppealBox({ evaluationId, criterionId, criterion, appeals, onCreate, onDecide }: Props) {
  const mine = appeals.filter((a) => a.criterionId === criterionId);
  const pending = mine.find((a) => a.status === 'pending');
  const [filing, setFiling] = useState(false);
  const [comment, setComment] = useState('');
  const [action, setAction] = useState<'uphold' | 'override'>('uphold');
  const [answer, setAnswer] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opts = options(criterion);
  const id = `${evaluationId}-${criterionId}`;

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {mine.map((a) => (
        <div key={a.id} className="rounded-md border border-line bg-canvas px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
            <span className="text-xs text-muted">Подана {fmt(a.createdAt)}{a.decidedAt ? ` · решение ${fmt(a.decidedAt)}` : ''}</span>
          </div>
          <p className="mt-1"><span className="font-medium">Возражение:</span> {a.comment}</p>
          {a.reviewerReason && <p className="mt-1"><span className="font-medium">Решение ревьюера:</span> {a.reviewerReason}</p>}
        </div>
      ))}

      {pending && (
        <form
          aria-label={`Решение по апелляции, критерий ${criterionId}`}
          className="space-y-2 rounded-md border border-brand-dark/40 bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const o = opts.find((x) => x.key === answer);
            if (action === 'override' && !o) return setError('Выберите новое значение');
            void run(() => onDecide({ appealId: pending.id, action, reason: reason.trim(), ...(action === 'override' && o ? { value: o.value, isNA: o.isNA } : {}) }));
          }}
        >
          <p className="flex items-center gap-2 text-sm font-medium"><Gavel aria-hidden className="size-4 text-accent" />Решение ревьюера</p>
          <p className="text-xs text-muted">Вход в систему и роли в демо не реализованы: решение принимает любой пользователь. Исходный ответ ИИ сохраняется всегда.</p>
          <div role="radiogroup" aria-label="Решение" className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name={`act-${id}`} checked={action === 'uphold'} onChange={() => setAction('uphold')} className="accent-brand" />Оставить оценку ИИ</label>
            <label className="flex items-center gap-2"><input type="radio" name={`act-${id}`} checked={action === 'override'} onChange={() => setAction('override')} className="accent-brand" />Изменить оценку</label>
          </div>
          {action === 'override' && (
            <Field id={`val-${id}`} label="Новое значение">
              <Select id={`val-${id}`} value={answer} onChange={(e) => setAnswer(e.target.value)}>
                <option value="">Выберите…</option>
                {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </Select>
            </Field>
          )}
          <Field id={`why-${id}`} label="Обоснование решения">
            <Textarea id={`why-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} required />
          </Field>
          <Button type="submit" variant="primary" size="sm" disabled={busy || !reason.trim()}>{busy ? 'Сохранение…' : 'Принять решение'}</Button>
        </form>
      )}

      {!pending && !filing && (
        <Button variant="ghost" size="sm" onClick={() => setFiling(true)}><MessageSquareWarning aria-hidden className="size-4" />Оспорить оценку</Button>
      )}
      {!pending && filing && (
        <form
          aria-label={`Апелляция, критерий ${criterionId}`}
          className="space-y-2 rounded-md border border-line-strong bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await onCreate(criterionId, comment.trim());
              setFiling(false);
              setComment('');
            });
          }}
        >
          <Field id={`cmt-${id}`} label="Почему вы не согласны с оценкой?">
            <Textarea id={`cmt-${id}`} value={comment} onChange={(e) => setComment(e.target.value)} required />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={busy || !comment.trim()}>{busy ? 'Отправка…' : 'Отправить апелляцию'}</Button>
            <Button type="button" size="sm" onClick={() => setFiling(false)}>Отмена</Button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
