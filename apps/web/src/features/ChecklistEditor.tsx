import { SaveChecklistInputSchema, type ChecklistVersion, type Criterion, type CriterionKind, type CriterionValue } from '@cqa/contracts';
import { ArrowDown, ArrowUp, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/utils';

type Props = {
  checklists: ChecklistVersion[];
  conversationCount: number;
  /** Saves a NEW immutable version and returns it. */
  onSave: (input: { title: string; sections?: ChecklistVersion['sections']; criteria: Criterion[] }) => Promise<ChecklistVersion>;
  /** Evaluates the given conversations with a version (rules and unchanged criteria are reused server-side). */
  onEvaluate: (checklistVersionId: string, scope: 'current' | 'all') => Promise<void>;
  hasCurrentConversation: boolean;
};

const KIND_LABEL: Record<CriterionKind, string> = { boolean: 'Да / Нет', 'discrete-scale': 'Шкала (ступени баллов)', enum: 'Список вариантов' };
const parseNumbers = (s: string) => s.split(/[,;\s]+/).filter(Boolean).map(Number);
const parseLabels = (s: string) => s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
const valuesText = (c: Criterion) => (c.kind === 'boolean' ? 'Да, Нет' : c.allowedValues.join(', '));

function nextId(criteria: Criterion[]) {
  const nums = criteria.map((c) => Number(c.id)).filter((n) => Number.isInteger(n));
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  let id = String(n).padStart(2, '0');
  while (criteria.some((c) => c.id === id)) id = String(Number(id) + 1).padStart(2, '0');
  return id;
}

function newCriterion(criteria: Criterion[]): Criterion {
  return { id: nextId(criteria), title: '', instructions: '', weight: 0, kind: 'boolean', allowedValues: [true, false], allowNA: false };
}

/** The values field is free text; it is parsed per kind. Returns the criterion with its allowedValues updated. */
function withValues(c: Criterion, text: string): Criterion {
  if (c.kind === 'discrete-scale') return { ...c, allowedValues: parseNumbers(text) as CriterionValue[] };
  if (c.kind === 'enum') return { ...c, allowedValues: parseLabels(text) };
  return c;
}

function withKind(c: Criterion, kind: CriterionKind): Criterion {
  const base = { ...c, kind, criticalFlag: kind === 'boolean' ? c.criticalFlag : undefined };
  if (kind === 'boolean') return { ...base, allowedValues: [true, false] };
  if (kind === 'discrete-scale') return { ...base, allowedValues: [0, 5, 10] };
  return { ...base, allowedValues: ['вариант 1', 'вариант 2'], weight: 0 };
}

export function ChecklistEditor({ checklists, conversationCount, onSave, onEvaluate, hasCurrentConversation }: Props) {
  const versions = useMemo(() => [...checklists].sort((a, b) => b.version - a.version), [checklists]);
  const [baseId, setBaseId] = useState(versions[0]?.id ?? '');
  const base = versions.find((v) => v.id === baseId) ?? versions[0];
  const [draft, setDraft] = useState<Criterion[]>(() => structuredClone(base?.criteria ?? []));
  const [title, setTitle] = useState(base?.title ?? '');
  const [valueText, setValueText] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [saved, setSaved] = useState<ChecklistVersion | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadVersion = (id: string) => {
    const v = versions.find((x) => x.id === id);
    if (!v) return;
    setBaseId(id);
    setDraft(structuredClone(v.criteria));
    setTitle(v.title);
    setValueText({});
    setOpen(null);
    setSaved(null);
    setSaveError(null);
  };

  const update = (id: string, f: (c: Criterion) => Criterion) => setDraft((d) => d.map((c) => (c.id === id ? f(c) : c)));
  const move = (i: number, by: -1 | 1) => setDraft((d) => {
    const j = i + by;
    if (j < 0 || j >= d.length) return d;
    const next = [...d];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  });

  const parsed = SaveChecklistInputSchema.safeParse({ title, sections: base?.sections, criteria: draft.map(clean) });
  const errors = new Map<string, string>();
  if (!parsed.success) for (const issue of parsed.error.issues) {
    const idx = issue.path[0] === 'criteria' ? Number(issue.path[1]) : -1;
    const key = idx >= 0 ? draft[idx]?.id ?? '' : '_';
    if (!errors.has(key)) errors.set(key, issue.message);
  }
  const dirty = base ? JSON.stringify({ t: title, c: draft.map(clean) }) !== JSON.stringify({ t: base.title, c: base.criteria.map(clean) }) : true;
  const weightSum = draft.reduce((s, c) => s + (c.criticalFlag ? 0 : c.weight), 0);

  const save = async () => {
    if (!parsed.success) return;
    setSaving(true);
    setSaveError(null);
    try {
      const v = await onSave(parsed.data);
      setSaved(v);
      setBaseId(v.id);
      setDraft(structuredClone(v.criteria));
      setValueText({});
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const evaluate = async (scope: 'current' | 'all') => {
    if (!saved) return;
    setBusy(scope);
    setSaveError(null);
    try {
      await onEvaluate(saved.id, scope);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col">
      <div className="space-y-3 border-b border-line bg-surface px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-end gap-3">
          <Field id="cl-title" label="Название чек-листа" className="min-w-60 flex-1">
            <Input id="cl-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field id="cl-version" label="Основа" className="w-56">
            <Select id="cl-version" value={baseId} onChange={(e) => loadVersion(e.target.value)}>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>Версия {v.version}{v === versions[0] ? ' (последняя)' : ''}</option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="text-xs text-muted">
          Сохранение создаёт новую версию. Старые версии и оценки по ним не меняются. Сумма весов: <strong className={weightSum === 100 ? 'text-brand-dark' : 'text-warn'}>{weightSum}</strong>
          {weightSum !== 100 && ' (итоговый балл считается от применимых весов, но обычно сумма равна 100)'}.
        </p>
      </div>

      <ol className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4 sm:p-6">
        {draft.map((c, i) => {
          const isOpen = open === c.id;
          const err = errors.get(c.id);
          return (
            <li key={c.id} className={cn('rounded-card border bg-surface', err ? 'border-danger/50' : 'border-line')}>
              <div className="flex items-center gap-2 px-3 py-2.5">
                <button type="button" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <span className="font-mono text-xs text-muted">{c.id}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{c.title || <em className="font-normal text-muted">Без названия</em>}</span>
                  <Badge>{c.criticalFlag ? 'флаг' : `вес ${c.weight}`}</Badge>
                  <Badge tone="neutral">{KIND_LABEL[c.kind]}</Badge>
                  {c.allowNA && <Badge>N/A</Badge>}
                </button>
                <Button variant="ghost" size="sm" aria-label={`Поднять критерий ${c.id}`} onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp aria-hidden className="size-4" /></Button>
                <Button variant="ghost" size="sm" aria-label={`Опустить критерий ${c.id}`} onClick={() => move(i, 1)} disabled={i === draft.length - 1}><ArrowDown aria-hidden className="size-4" /></Button>
                <Button variant="ghost" size="sm" aria-label={`Удалить критерий ${c.id}`} onClick={() => setDraft((d) => d.filter((x) => x.id !== c.id))}><Trash2 aria-hidden className="size-4 text-danger" /></Button>
              </div>
              {err && !isOpen && <p role="alert" className="px-3 pb-2 text-xs text-danger">{err}</p>}

              {isOpen && (
                <div className="grid gap-3 border-t border-line px-3 py-3 sm:grid-cols-2">
                  <Field id={`t-${c.id}`} label="Название" className="sm:col-span-2">
                    <Input id={`t-${c.id}`} value={c.title} onChange={(e) => update(c.id, (x) => ({ ...x, title: e.target.value }))} />
                  </Field>
                  <Field id={`i-${c.id}`} label="Как оценивать (инструкция для модели и ревьюера)" className="sm:col-span-2">
                    <Textarea id={`i-${c.id}`} value={c.instructions} onChange={(e) => update(c.id, (x) => ({ ...x, instructions: e.target.value }))} />
                  </Field>
                  <Field id={`k-${c.id}`} label="Тип ответа">
                    <Select id={`k-${c.id}`} value={c.kind} onChange={(e) => { setValueText((v) => ({ ...v, [c.id]: '' })); update(c.id, (x) => withKind(x, e.target.value as CriterionKind)); }}>
                      {(Object.keys(KIND_LABEL) as CriterionKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </Select>
                  </Field>
                  <Field id={`w-${c.id}`} label="Вес" hint={c.criticalFlag ? 'У флага веса нет' : c.kind === 'enum' ? 'У списка вариантов вес 0' : 'Баллы за максимальный ответ'}>
                    <Input id={`w-${c.id}`} type="number" min={0} value={c.weight} disabled={c.criticalFlag || c.kind === 'enum'} onChange={(e) => update(c.id, (x) => ({ ...x, weight: Number(e.target.value) }))} />
                  </Field>
                  {c.kind !== 'boolean' && (
                    <Field id={`v-${c.id}`} label={c.kind === 'discrete-scale' ? 'Ступени баллов (через запятую)' : 'Варианты (через запятую)'} hint={c.kind === 'discrete-scale' ? 'Наибольшая ступень даёт полный вес' : undefined} className="sm:col-span-2">
                      <Input id={`v-${c.id}`} value={valueText[c.id] ?? valuesText(c)} onChange={(e) => { setValueText((v) => ({ ...v, [c.id]: e.target.value })); update(c.id, (x) => withValues(x, e.target.value)); }} />
                    </Field>
                  )}
                  <div className="space-y-2 sm:col-span-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={c.allowNA} onChange={(e) => update(c.id, (x) => ({ ...x, allowNA: e.target.checked }))} className="size-4 accent-brand-dark" />
                      Допускается N/A
                    </label>
                    {c.allowNA && (
                      <Field id={`n-${c.id}`} label="Когда ставить N/A">
                        <Input id={`n-${c.id}`} value={c.naCondition ?? ''} onChange={(e) => update(c.id, (x) => ({ ...x, naCondition: e.target.value || undefined }))} />
                      </Field>
                    )}
                    <label className={cn('flex items-center gap-2 text-sm', c.kind !== 'boolean' && 'opacity-50')}>
                      <input type="checkbox" checked={!!c.criticalFlag} disabled={c.kind !== 'boolean'} onChange={(e) => update(c.id, (x) => ({ ...x, criticalFlag: e.target.checked || undefined, weight: e.target.checked ? 0 : x.weight }))} className="size-4 accent-brand-dark" />
                      Флаг грубого нарушения (не входит в баллы)
                    </label>
                    {c.detector && <p className="text-xs text-muted">Для этого критерия включено детерминированное правило «{c.detector}»: оно сохранится в новой версии.</p>}
                  </div>
                  {err && <p role="alert" className="text-sm text-danger sm:col-span-2">{err}</p>}
                </div>
              )}
            </li>
          );
        })}
        <li>
          <Button onClick={() => { const c = newCriterion(draft); setDraft((d) => [...d, c]); setOpen(c.id); }}>
            <Plus aria-hidden className="size-4" />Добавить критерий
          </Button>
        </li>
      </ol>

      <div className="space-y-2 border-t border-line bg-surface px-4 py-3 sm:px-6">
        {errors.get('_') && <p role="alert" className="text-sm text-danger">{errors.get('_')}</p>}
        {saveError && <p role="alert" className="text-sm text-danger">{saveError}</p>}
        {saved && (
          <div role="status" className="flex flex-wrap items-center gap-3 rounded-md bg-brand-soft px-3 py-2 text-sm text-brand-dark">
            <CheckCircle2 aria-hidden className="size-4" />
            <span>Сохранена версия {saved.version}.</span>
            <Button size="sm" variant="primary" disabled={!hasCurrentConversation || busy !== null} onClick={() => evaluate('current')}>{busy === 'current' ? 'Идёт оценка…' : 'Оценить выбранный диалог'}</Button>
            <Button size="sm" disabled={busy !== null || conversationCount === 0} onClick={() => evaluate('all')}>{busy === 'all' ? 'Идёт оценка…' : `Оценить все диалоги (${conversationCount})`}</Button>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">{!parsed.success ? 'Исправьте ошибки, чтобы сохранить.' : dirty ? 'Есть несохранённые изменения.' : 'Изменений нет.'}</p>
          <Button variant="primary" onClick={save} disabled={!parsed.success || !dirty || saving}>{saving ? 'Сохранение…' : 'Сохранить как новую версию'}</Button>
        </div>
      </div>
    </div>
  );
}

/** Strips empty optionals so dirty-checking and schema parsing are not tripped by `undefined` keys. */
function clean(c: Criterion): Criterion {
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) as Criterion;
}
