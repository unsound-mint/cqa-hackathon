import { SaveChecklistInputSchema, type ChecklistVersion, type Criterion, type CriterionKind, type CriterionValue } from '@cqa/contracts';
import { ArrowDown, ArrowUp, CheckCircle2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/error-note';
import { cn } from '@/lib/utils';
import { useMinWidth } from '@/lib/media';

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
  const [saveError, setSaveError] = useState<unknown>(null);
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
  /** Sections as the list shows them; unsectioned criteria last. Up/down moves within a section, never across. */
  const sections = base?.sections ?? [];
  const sectionKey = (c: Criterion) => (sections.some((s) => s.id === c.sectionId) ? c.sectionId! : '_');
  const neighbour = (id: string, by: -1 | 1) => {
    const c = draft.find((x) => x.id === id);
    if (!c) return -1;
    const peers = draft.map((x, i) => [x, i] as const).filter(([x]) => sectionKey(x) === sectionKey(c)).map(([, i]) => i);
    const at = peers.indexOf(draft.indexOf(c));
    return peers[at + by] ?? -1;
  };
  const move = (id: string, by: -1 | 1) => {
    const j = neighbour(id, by);
    if (j < 0) return;
    setDraft((d) => {
      const i = d.findIndex((x) => x.id === id);
      const next = [...d];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };
  const remove = (c: Criterion) => {
    const i = draft.indexOf(c);
    setRemoved({ c, at: i });
    setDraft((d) => d.filter((x) => x.id !== c.id));
    setOpen(draft[i + 1]?.id ?? draft[i - 1]?.id ?? null);
  };
  const groups = sections.length
    ? [...sections.map((s) => ({ id: s.id, title: s.title, items: draft.filter((c) => sectionKey(c) === s.id) })), { id: '_', title: 'Без раздела', items: draft.filter((c) => sectionKey(c) === '_') }].filter((g) => g.items.length)
    : [{ id: '_', title: '', items: draft }];
  /** Wide screens: list beside the selected criterion's form. Narrow: the form opens inside the list (accordion). */
  const twoCol = useMinWidth(1024);
  const selected = draft.find((c) => c.id === open) ?? (twoCol ? draft[0] : undefined);
  const focusForm = useRef(false);
  useEffect(() => {
    if (focusForm.current) {
      focusForm.current = false;
      document.getElementById('crit-form-heading')?.focus({ preventScroll: true });
    }
  }, [open]);

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
      setSaveError(e);
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
      setSaveError(e);
    } finally {
      setBusy(null);
    }
  };

  const form = (c: Criterion) => {
    const zeroWeight = !c.criticalFlag && c.kind !== 'enum' && c.weight === 0;
    return (
      <div className="space-y-4">
        <div className={cn('flex flex-wrap items-center gap-2', twoCol ? 'justify-between' : 'justify-end')}>
          <h2 id="crit-form-heading" tabIndex={-1} className={cn('text-base font-semibold outline-none', !twoCol && 'sr-only')}>
            <span className="mr-2 tabular-nums text-muted">{c.id}</span>{c.title || 'Новый критерий'}
          </h2>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" aria-label={`Поднять критерий ${c.id}`} title="Выше в разделе" onClick={() => move(c.id, -1)} disabled={neighbour(c.id, -1) < 0}><ArrowUp aria-hidden className="size-4" /></Button>
            <Button variant="ghost" size="sm" aria-label={`Опустить критерий ${c.id}`} title="Ниже в разделе" onClick={() => move(c.id, 1)} disabled={neighbour(c.id, 1) < 0}><ArrowDown aria-hidden className="size-4" /></Button>
            <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft" aria-label={`Удалить критерий ${c.id}`} onClick={() => remove(c)}><Trash2 aria-hidden className="size-4" />Удалить</Button>
          </div>
        </div>
        <div className="grid gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="space-y-4">
            <Field id={`t-${c.id}`} label="Название" error={fieldError(c.id, 'title')}>
              <Input id={`t-${c.id}`} value={c.title} onBlur={touch(c.id, 'title')} onChange={(e) => update(c.id, (x) => ({ ...x, title: e.target.value }))} />
            </Field>
            <Field id={`i-${c.id}`} label="Как оценивать (инструкция для модели и ревьюера)" hint="Модель получает этот текст как правило оценки; проверяющий видит его в карточке критерия." error={fieldError(c.id, 'instructions')}>
              <Textarea id={`i-${c.id}`} value={c.instructions} onBlur={touch(c.id, 'instructions')} onChange={(e) => update(c.id, (x) => ({ ...x, instructions: e.target.value }))} className="min-h-40" />
            </Field>
            <div className="space-y-2">
              <label className="flex min-h-8 items-center gap-2 text-sm">
                <input type="checkbox" checked={c.allowNA} onChange={(e) => update(c.id, (x) => ({ ...x, allowNA: e.target.checked }))} className="size-4 accent-brand" />
                Может быть неприменим (N/A)
              </label>
              {c.allowNA && (
                <Field id={`n-${c.id}`} label="Когда ставить N/A">
                  <Input id={`n-${c.id}`} value={c.naCondition ?? ''} onChange={(e) => update(c.id, (x) => ({ ...x, naCondition: e.target.value || undefined }))} />
                </Field>
              )}
            </div>
          </div>
          <div className="space-y-4">
            {sections.length > 0 && (
              <Field id={`s-${c.id}`} label="Раздел">
                <Select id={`s-${c.id}`} value={c.sectionId ?? ''} onChange={(e) => update(c.id, (x) => ({ ...x, sectionId: e.target.value || undefined }))}>
                  {sections.map((sec) => <option key={sec.id} value={sec.id}>{sec.title}</option>)}
                  <option value="">Без раздела</option>
                </Select>
              </Field>
            )}
            <Field id={`k-${c.id}`} label="Тип ответа">
              <Select id={`k-${c.id}`} value={c.kind} onChange={(e) => { setValueText((v) => ({ ...v, [c.id]: '' })); update(c.id, (x) => withKind(x, e.target.value as CriterionKind)); }}>
                {(Object.keys(KIND_LABEL) as CriterionKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </Select>
            </Field>
            {c.kind !== 'boolean' && (
              <Field id={`v-${c.id}`} label={c.kind === 'discrete-scale' ? 'Ступени баллов (через запятую)' : 'Варианты (через запятую)'} hint={c.kind === 'discrete-scale' ? 'Наибольшая ступень даёт полный вес' : undefined} error={fieldError(c.id, 'allowedValues')}>
                <Input id={`v-${c.id}`} value={valueText[c.id] ?? valuesText(c)} onBlur={touch(c.id, 'allowedValues')} onChange={(e) => { setValueText((v) => ({ ...v, [c.id]: e.target.value })); update(c.id, (x) => withValues(x, e.target.value)); }} />
              </Field>
            )}
            <Field id={`w-${c.id}`} label="Вес" error={fieldError(c.id, 'weight')} hint={c.criticalFlag ? 'У флага веса нет' : c.kind === 'enum' ? 'У списка вариантов вес 0' : zeroWeight ? 'Вес 0: критерий не влияет на итоговый балл' : 'Баллы за максимальный ответ'}>
              <Input id={`w-${c.id}`} type="number" min={0} value={c.weight} disabled={c.criticalFlag || c.kind === 'enum'} onBlur={touch(c.id, 'weight')} onChange={(e) => update(c.id, (x) => ({ ...x, weight: Number(e.target.value) }))} />
            </Field>
            <label className={cn('flex min-h-8 items-start gap-2 text-sm', c.kind !== 'boolean' && 'opacity-50')}>
              <input type="checkbox" checked={!!c.criticalFlag} disabled={c.kind !== 'boolean'} onChange={(e) => update(c.id, (x) => ({ ...x, criticalFlag: e.target.checked || undefined, weight: e.target.checked ? 0 : x.weight }))} className="mt-1 size-4 accent-brand" />
              <span>Флаг грубого нарушения<span className="block text-xs text-muted">Не даёт баллов: «да» отмечает диалог как грубое нарушение.</span></span>
            </label>
            {c.detector && <p className="text-xs text-muted">Оценивается автоматическим правилом («{c.detector}»), без модели. Правило сохранится в новой версии.</p>}
          </div>
        </div>
        {(['criticalFlag', 'id', 'other'] as const).map((f) => fieldError(c.id, f)).filter(Boolean).map((m) => <p key={m} role="alert" className="text-sm text-danger">{m}</p>)}
      </div>
    );
  };

  const item = (c: Criterion) => {
    const rowErrors = errors.get(c.id);
    const visible = rowErrors ? [...rowErrors.keys()].filter((f) => shows(c.id, f)) : [];
    const isOpen = twoCol ? selected?.id === c.id : open === c.id;
    return (
      <li key={c.id} id={`crit-row-${c.id}`} className={cn('scroll-mt-4 rounded-xl', !twoCol && isOpen && 'bg-surface ring-1 ring-brand/60')}>
        <button
          type="button"
          onClick={() => {
            if (twoCol) {
              focusForm.current = true;
              setOpen(c.id);
            } else setOpen(isOpen ? null : c.id);
          }}
          {...(twoCol ? { 'aria-current': isOpen ? ('true' as const) : undefined } : { 'aria-expanded': isOpen })}
          className={cn('flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition-colors', twoCol && isOpen ? 'bg-brand-soft' : 'hover:bg-fill')}
        >
          <span className="text-sm tabular-nums text-muted">{c.id}</span>
          <span className={cn('line-clamp-2 min-w-0 flex-1 text-sm', isOpen && 'font-medium')}>{c.title || <em className="text-muted">Без названия</em>}</span>
          {visible.length > 0 && <span className="mt-2 size-2 shrink-0 rounded-full bg-danger" aria-label="Есть ошибки" />}
          <span className="shrink-0 text-xs tabular-nums text-muted">{c.criticalFlag ? 'флаг' : `${c.weight}${c.allowNA ? ' · N/A' : ''}`}</span>
        </button>
        {visible.length > 0 && !isOpen && <p role="alert" className="px-3 pb-2 text-xs text-danger">Исправьте: {visible.map((f) => FIELD_NAME[f]).join(', ')}.</p>}
        {!twoCol && isOpen && <div className="border-t border-line p-3">{form(c)}</div>}
      </li>
    );
  };

  const addButton = (
    <Button size="sm" variant="ghost" className="w-full justify-start" onClick={() => { const c = newCriterion(draft); focusNew.current = c.id; setDraft((d) => [...d, c]); setOpen(c.id); }}>
      <Plus aria-hidden className="size-4" />Добавить критерий
    </Button>
  );

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col">
      <div className="space-y-3 px-4 pb-2 pt-4 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold leading-8">Чек-лист</h1>
          <p className="max-w-prose text-sm text-muted">Критерии, по которым модель оценивает диалоги. Сохранение создаёт новую версию: прошлые версии и оценки по ним не меняются.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field id="cl-title" label="Название чек-листа" className="min-w-60 flex-1" error={attempted ? errors.get('_')?.get('title') : null}>
            <Input id="cl-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field id="cl-version" label="Начать с версии" className="w-56">
            <Select id="cl-version" value={baseId} onChange={(e) => loadVersion(e.target.value)}>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>Версия {v.version}{v === versions[0] ? ' (последняя)' : ''}</option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      <div className={cn('min-h-0 flex-1 gap-4 px-4 pb-4 sm:px-6', twoCol ? 'grid grid-cols-[22rem_minmax(0,1fr)]' : 'flex flex-col')}>
        <nav aria-label="Критерии" className="flex min-h-0 flex-col overflow-y-auto rounded-card glass-panel p-2">
          <p className="flex items-baseline justify-between px-3 pb-1 pt-2 text-xs text-muted">
            <span>Критериев: {draft.length}</span>
            <span>Сумма весов: <strong className={weightSum === 100 ? 'text-accent' : 'text-warn'}>{weightSum}</strong></span>
          </p>
          {weightSum !== 100 && <p className="px-3 pb-1 text-xs text-muted">Итог считается от применимых весов, но обычно сумма равна 100.</p>}
          {groups.map((g) => (
            <div key={g.id}>
              {g.title && <h2 className="px-3 pb-1 pt-3 text-xs font-medium text-muted">{g.title}</h2>}
              <ol>{g.items.map(item)}</ol>
            </div>
          ))}
          {draft.length === 0 && <p className="px-3 py-2 text-sm text-muted">Критериев нет. Добавьте первый.</p>}
          <div className="pt-1">{addButton}</div>
        </nav>
        {twoCol && (
          <section aria-label="Критерий" className="min-h-0 overflow-y-auto rounded-card glass-panel p-6">
            {selected ? form(selected) : <p className="text-sm text-muted">Выберите критерий слева или добавьте новый.</p>}
          </section>
        )}
      </div>

      <div className="mx-4 mb-4 space-y-2 rounded-card glass-panel px-4 py-3 sm:mx-6">
        {removed && (
          <p role="status" className="flex flex-wrap items-center gap-3 text-sm">
            Критерий {removed.c.id}{removed.c.title ? ` «${removed.c.title}»` : ''} удалён из черновика.
            <Button size="sm" variant="ghost" onClick={() => { setDraft((d) => [...d.slice(0, removed.at), removed.c, ...d.slice(removed.at)]); setOpen(removed.c.id); setRemoved(null); }}><RotateCcw aria-hidden className="size-4" />Вернуть</Button>
          </p>
        )}
        {attempted && errors.get('_')?.get('other') && <p role="alert" className="text-sm text-danger">{errors.get('_')!.get('other')}</p>}
        <ErrorNote error={saveError} />
        {saved && (
          <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl bg-brand-soft px-4 py-2 text-sm text-accent">
            <CheckCircle2 aria-hidden className="size-4" />
            <span>Сохранена версия {saved.version}.</span>
            <Button size="sm" variant="primary" disabled={!currentConversationId || busy !== null} onClick={() => evaluate('current')}>{busy === 'current' ? 'Идёт оценка…' : currentConversationId ? `Оценить диалог ${currentConversationId}` : 'Оценить открытый диалог'}</Button>
            <Button size="sm" disabled={busy !== null || conversationCount === 0} onClick={() => evaluate('all')}>{busy === 'all' ? 'Идёт оценка…' : `Оценить все диалоги (${conversationCount})`}</Button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
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
