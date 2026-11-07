import { SaveChecklistInputSchema, type ChecklistVersion, type Criterion, type CriterionKind, type CriterionValue } from '@cqa/contracts';
import { ArrowDown, ArrowUp, CheckCircle2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  /** The dialog last opened in the review screen: "Оценить диалог …" applies the new version to it. */
  currentConversationId: string | null;
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

/** A new (scored) criterion joins the section of the last scored one, not the serious-violation flags at the end. */
function newCriterion(criteria: Criterion[]): Criterion {
  const sectionId = [...criteria].reverse().find((c) => !c.criticalFlag)?.sectionId;
  return { id: nextId(criteria), title: '', instructions: '', weight: 0, kind: 'boolean', allowedValues: [true, false], allowNA: false, ...(sectionId ? { sectionId } : {}) };
}

type FieldKey = 'title' | 'instructions' | 'weight' | 'allowedValues' | 'criticalFlag' | 'id' | 'other';
const FIELD_NAME: Record<FieldKey, string> = { title: 'название', instructions: 'инструкция', weight: 'вес', allowedValues: 'ответы', criticalFlag: 'флаг', id: 'номер', other: 'поля' };

/** Reviewer-facing Russian text per field; the schema's own messages are English and for developers. */
function fieldMessage(field: FieldKey, c: Criterion): string {
  if (field === 'title') return 'Введите название критерия.';
  if (field === 'instructions') return 'Опишите, как оценивать: без инструкции модель не сможет оценить критерий.';
  if (field === 'allowedValues') {
    if (c.kind === 'discrete-scale') return 'Нужно не меньше двух ступеней: неотрицательные числа через запятую, без повторов, наибольшая больше 0.';
    if (c.kind === 'enum') return 'Нужен хотя бы один вариант, без повторов.';
    return 'Ответ «Да / Нет» должен допускать оба значения.';
  }
  if (field === 'weight') return c.kind === 'enum' ? 'У списка вариантов вес 0.' : c.criticalFlag ? 'У флага грубого нарушения вес 0.' : 'Вес: неотрицательное число.';
  if (field === 'criticalFlag') return 'Флаг грубого нарушения бывает только у ответа «Да / Нет».';
  if (field === 'id') return 'Номер критерия повторяется.';
  return 'Проверьте поля критерия.';
}
const asField = (k: unknown): FieldKey => (['title', 'instructions', 'weight', 'allowedValues', 'criticalFlag', 'id'].includes(String(k)) ? (k as FieldKey) : 'other');

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

export function ChecklistEditor({ checklists, conversationCount, onSave, onEvaluate, currentConversationId }: Props) {
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
  /** Field errors show once a field was left or a save was tried, not while a new criterion is still empty. */
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const [removed, setRemoved] = useState<{ c: Criterion; at: number } | null>(null);
  const focusNew = useRef<string | null>(null);
  useEffect(() => {
    if (open && focusNew.current === open) {
      focusNew.current = null;
      document.getElementById(`t-${open}`)?.focus();
    }
  }, [open]);
  const touch = (id: string, f: FieldKey) => () => setTouched((t) => (t.has(`${id}.${f}`) ? t : new Set(t).add(`${id}.${f}`)));

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
    setTouched(new Set());
    setAttempted(false);
    setRemoved(null);
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
  /** criterion id -> field -> message; '_' holds checklist-level problems. */
  const errors = new Map<string, Map<FieldKey, string>>();
  const addError = (key: string, f: FieldKey, msg: string) => {
    const m = errors.get(key) ?? errors.set(key, new Map()).get(key)!;
    if (!m.has(f)) m.set(f, msg);
  };
  if (!parsed.success) for (const issue of parsed.error.issues) {
    const idx = issue.path[0] === 'criteria' && typeof issue.path[1] === 'number' ? issue.path[1] : -1;
    const c = idx >= 0 ? draft[idx] : undefined;
    if (c) addError(c.id, asField(issue.path[2]), fieldMessage(asField(issue.path[2]), c));
    else if (issue.path[0] === 'title') addError('_', 'title', 'Введите название чек-листа.');
    else addError('_', 'other', draft.length === 0 ? 'Добавьте хотя бы один критерий.' : 'Номера критериев не должны повторяться.');
  }
  // Not a schema rule (stored data may lack it), but a criterion without instructions cannot be graded by the model.
  for (const c of draft) if (!c.instructions.trim()) addError(c.id, 'instructions', fieldMessage('instructions', c));
  const valid = errors.size === 0;
  const shows = (id: string, f: FieldKey) => attempted || touched.has(`${id}.${f}`);
  const fieldError = (id: string, f: FieldKey) => (shows(id, f) ? errors.get(id)?.get(f) ?? null : null);
  const dirty = base ? JSON.stringify({ t: title, c: draft.map(clean) }) !== JSON.stringify({ t: base.title, c: base.criteria.map(clean) }) : true;
  const weightSum = draft.reduce((s, c) => s + (c.criticalFlag ? 0 : c.weight), 0);

  const save = async () => {
    if (!valid || !parsed.success) {
      setAttempted(true);
      const first = draft.find((c) => errors.has(c.id));
      if (first) {
        setOpen(first.id);
        document.getElementById(`crit-row-${first.id}`)?.scrollIntoView?.({ block: 'nearest' });
      }
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const v = await onSave(parsed.data);
      setSaved(v);
      setBaseId(v.id);
      setDraft(structuredClone(v.criteria));
      setTitle(v.title);
      setValueText({});
      setTouched(new Set());
      setAttempted(false);
      setRemoved(null);
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
          <div className="w-full">
            <h1 className="text-2xl font-semibold leading-8">Чек-лист</h1>
            <p className="max-w-prose text-sm text-muted">Сохранение создаёт новую версию: старые версии и оценки по ним не меняются.</p>
          </div>
          <Field id="cl-title" label="Название чек-листа" className="min-w-60 flex-1" error={attempted ? errors.get('_')?.get('title') : null}>
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
          Сумма весов: <strong className={weightSum === 100 ? 'text-accent' : 'text-warn'}>{weightSum}</strong>
          {weightSum !== 100 && ' (итоговый балл считается от применимых весов, но обычно сумма равна 100)'}.
        </p>
      </div>

      <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-6">
        {draft.map((c, i) => {
          const isOpen = open === c.id;
          const rowErrors = errors.get(c.id);
          const visible = rowErrors ? [...rowErrors.keys()].filter((f) => shows(c.id, f)) : [];
          const zeroWeight = !c.criticalFlag && c.kind !== 'enum' && c.weight === 0;
          return (
            <li key={c.id} id={`crit-row-${c.id}`} className={cn('scroll-mt-4 rounded-card border bg-surface', visible.length ? 'border-danger/50' : 'border-line')}>
              <div className="flex items-center gap-2 px-3 py-3">
                <button type="button" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <span className="font-mono text-xs text-muted">{c.id}</span>
                  <span className="min-w-0 flex-1 truncate text-base font-medium">{c.title || <em className="font-normal text-muted">Без названия</em>}</span>
                  <span className="hidden shrink-0 text-xs text-muted sm:inline">{c.criticalFlag ? 'флаг' : `вес ${c.weight}`} · {KIND_LABEL[c.kind]}{c.allowNA ? ' · N/A' : ''}</span>
                </button>
                <Button variant="ghost" size="sm" aria-label={`Поднять критерий ${c.id}`} onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp aria-hidden className="size-4" /></Button>
                <Button variant="ghost" size="sm" aria-label={`Опустить критерий ${c.id}`} onClick={() => move(i, 1)} disabled={i === draft.length - 1}><ArrowDown aria-hidden className="size-4" /></Button>
                <Button variant="ghost" size="sm" className="hover:bg-danger-soft" aria-label={`Удалить критерий ${c.id}`} onClick={() => { setRemoved({ c, at: i }); setDraft((d) => d.filter((x) => x.id !== c.id)); }}><Trash2 aria-hidden className="size-4 text-muted" /></Button>
              </div>
              {visible.length > 0 && !isOpen && <p role="alert" className="px-3 pb-2 text-xs text-danger">Исправьте: {visible.map((f) => FIELD_NAME[f]).join(', ')}.</p>}

              {isOpen && (
                <div className="grid gap-3 border-t border-line px-3 py-3 sm:grid-cols-2">
                  <Field id={`t-${c.id}`} label="Название" className="sm:col-span-2" error={fieldError(c.id, 'title')}>
                    <Input id={`t-${c.id}`} value={c.title} onBlur={touch(c.id, 'title')} onChange={(e) => update(c.id, (x) => ({ ...x, title: e.target.value }))} />
                  </Field>
                  <Field id={`i-${c.id}`} label="Как оценивать (инструкция для модели и ревьюера)" className="sm:col-span-2" error={fieldError(c.id, 'instructions')}>
                    <Textarea id={`i-${c.id}`} value={c.instructions} onBlur={touch(c.id, 'instructions')} onChange={(e) => update(c.id, (x) => ({ ...x, instructions: e.target.value }))} />
                  </Field>
                  {(base?.sections?.length ?? 0) > 0 && (
                    <Field id={`s-${c.id}`} label="Раздел" className="sm:col-span-2">
                      <Select id={`s-${c.id}`} value={c.sectionId ?? ''} onChange={(e) => update(c.id, (x) => ({ ...x, sectionId: e.target.value || undefined }))}>
                        {base!.sections!.map((sec) => <option key={sec.id} value={sec.id}>{sec.title}</option>)}
                        <option value="">Без раздела (в конце, «Прочее»)</option>
                      </Select>
                    </Field>
                  )}
                  <Field id={`k-${c.id}`} label="Тип ответа">
                    <Select id={`k-${c.id}`} value={c.kind} onChange={(e) => { setValueText((v) => ({ ...v, [c.id]: '' })); update(c.id, (x) => withKind(x, e.target.value as CriterionKind)); }}>
                      {(Object.keys(KIND_LABEL) as CriterionKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </Select>
                  </Field>
                  <Field id={`w-${c.id}`} label="Вес" error={fieldError(c.id, 'weight')} hint={c.criticalFlag ? 'У флага веса нет' : c.kind === 'enum' ? 'У списка вариантов вес 0' : zeroWeight ? 'Вес 0: критерий не влияет на итоговый балл' : 'Баллы за максимальный ответ'}>
                    <Input id={`w-${c.id}`} type="number" min={0} value={c.weight} disabled={c.criticalFlag || c.kind === 'enum'} onBlur={touch(c.id, 'weight')} onChange={(e) => update(c.id, (x) => ({ ...x, weight: Number(e.target.value) }))} />
                  </Field>
                  {c.kind !== 'boolean' && (
                    <Field id={`v-${c.id}`} label={c.kind === 'discrete-scale' ? 'Ступени баллов (через запятую)' : 'Варианты (через запятую)'} hint={c.kind === 'discrete-scale' ? 'Наибольшая ступень даёт полный вес' : undefined} className="sm:col-span-2" error={fieldError(c.id, 'allowedValues')}>
                      <Input id={`v-${c.id}`} value={valueText[c.id] ?? valuesText(c)} onBlur={touch(c.id, 'allowedValues')} onChange={(e) => { setValueText((v) => ({ ...v, [c.id]: e.target.value })); update(c.id, (x) => withValues(x, e.target.value)); }} />
                    </Field>
                  )}
                  <div className="space-y-2 sm:col-span-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={c.allowNA} onChange={(e) => update(c.id, (x) => ({ ...x, allowNA: e.target.checked }))} className="size-4 accent-brand" />
                      Допускается N/A
                    </label>
                    {c.allowNA && (
                      <Field id={`n-${c.id}`} label="Когда ставить N/A">
                        <Input id={`n-${c.id}`} value={c.naCondition ?? ''} onChange={(e) => update(c.id, (x) => ({ ...x, naCondition: e.target.value || undefined }))} />
                      </Field>
                    )}
                    <label className={cn('flex items-center gap-2 text-sm', c.kind !== 'boolean' && 'opacity-50')}>
                      <input type="checkbox" checked={!!c.criticalFlag} disabled={c.kind !== 'boolean'} onChange={(e) => update(c.id, (x) => ({ ...x, criticalFlag: e.target.checked || undefined, weight: e.target.checked ? 0 : x.weight }))} className="size-4 accent-brand" />
                      Флаг грубого нарушения (не входит в баллы)
                    </label>
                    {c.detector && <p className="text-xs text-muted">Для этого критерия включено детерминированное правило «{c.detector}»: оно сохранится в новой версии.</p>}
                  </div>
                  {(['criticalFlag', 'id', 'other'] as const).map((f) => fieldError(c.id, f)).filter(Boolean).map((m) => <p key={m} role="alert" className="text-sm text-danger sm:col-span-2">{m}</p>)}
                </div>
              )}
            </li>
          );
        })}
        <li>
          <Button onClick={() => { const c = newCriterion(draft); focusNew.current = c.id; setDraft((d) => [...d, c]); setOpen(c.id); }}>
            <Plus aria-hidden className="size-4" />Добавить критерий
          </Button>
        </li>
      </ol>

      <div className="space-y-2 border-t border-line bg-surface px-4 py-3 sm:px-6">
        {removed && (
          <p role="status" className="flex flex-wrap items-center gap-3 text-sm">
            Критерий {removed.c.id}{removed.c.title ? ` «${removed.c.title}»` : ''} удалён из черновика.
            <Button size="sm" variant="ghost" onClick={() => { setDraft((d) => [...d.slice(0, removed.at), removed.c, ...d.slice(removed.at)]); setRemoved(null); }}><RotateCcw aria-hidden className="size-4" />Вернуть</Button>
          </p>
        )}
        {attempted && errors.get('_')?.get('other') && <p role="alert" className="text-sm text-danger">{errors.get('_')!.get('other')}</p>}
        {saveError && <p role="alert" className="text-sm text-danger">Не удалось сохранить: {saveError}</p>}
        {saved && (
          <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl bg-brand-soft px-4 py-2 text-sm text-accent">
            <CheckCircle2 aria-hidden className="size-4" />
            <span>Сохранена версия {saved.version}.</span>
            <Button size="sm" variant="primary" disabled={!currentConversationId || busy !== null} onClick={() => evaluate('current')}>{busy === 'current' ? 'Идёт оценка…' : currentConversationId ? `Оценить диалог ${currentConversationId}` : 'Оценить открытый диалог'}</Button>
            <Button size="sm" disabled={busy !== null || conversationCount === 0} onClick={() => evaluate('all')}>{busy === 'all' ? 'Идёт оценка…' : `Оценить все диалоги (${conversationCount})`}</Button>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">{attempted && !valid ? 'Исправьте отмеченные поля, чтобы сохранить.' : dirty ? 'Есть несохранённые изменения.' : 'Изменений нет.'}</p>
          <div className="flex flex-wrap justify-end gap-2">
            {dirty && base && <Button variant="ghost" onClick={() => loadVersion(base.id)} disabled={saving}>Вернуть версию {base.version}</Button>}
            <Button variant="primary" onClick={save} disabled={!dirty || saving}>{saving ? 'Сохранение…' : 'Сохранить как новую версию'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Strips empty optionals so dirty-checking and schema parsing are not tripped by `undefined` keys. */
function clean(c: Criterion): Criterion {
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) as Criterion;
}
