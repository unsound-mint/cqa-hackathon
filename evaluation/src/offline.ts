import { z } from 'zod';
import { ChecklistVersionSchema, ConversationSchema, CriterionValueSchema, computeTotal } from '@cqa/contracts';
import { LABEL_COLUMNS } from './labels.js';
import { toCsv } from './csv.js';

export const KitSchema = z.object({ id: z.string(), checklist: ChecklistVersionSchema, conversations: z.array(ConversationSchema).min(1) });
export type Kit = z.infer<typeof KitSchema>;
const LabelSchema = z.object({ conversationId: z.string(), criterionId: z.string(), value: CriterionValueSchema.nullable(), isNA: z.boolean(), evidence: z.array(z.number().int().nonnegative()), inspectedRange: z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }).nullish(), rationale: z.string(), uncertainty: z.string(), reviewer: z.string(), adjudicated: z.boolean() });
type Label = z.infer<typeof LabelSchema>;
export function validateLabel(kit: Kit, input: unknown): Label {
  const l = LabelSchema.parse(input);
  const cv = kit.conversations.find(c => c.id === l.conversationId);
  const cr = kit.checklist.criteria.find(c => c.id === l.criterionId);
  if (!cv || !cr) throw Error('Неизвестный диалог или критерий');
  if (l.isNA ? !cr.allowNA || l.value !== null : !cr.allowedValues.includes(l.value!)) throw Error('Недопустимый ответ');
  if (l.evidence.some(i => i >= cv.transcript.length)) throw Error('Номер сообщения вне диалога');
  const r = l.inspectedRange;
  if (r && (r.from > r.to || r.to >= cv.transcript.length)) throw Error('Диапазон вне диалога');
  return l;
}
const EventSchema = z.object({ at: z.string(), conversationId: z.string(), criterionId: z.string(), label: LabelSchema.nullable() });
const ProfileSchema = z.object({ id: z.string().min(1), name: z.string().trim().min(1).max(100) });
const BackupSchema = z.object({ profile: ProfileSchema, kitId: z.string(), labels: z.array(LabelSchema), history: z.array(EventSchema) });
export function validateBackup(kit: Kit, raw: unknown) {
  const b = BackupSchema.parse(raw);
  if (b.kitId !== kit.id) throw Error('Резервная копия от другого набора данных');
  const seen = new Set<string>();
  for (const l of b.labels) {
    validateLabel(kit, l);
    const key = JSON.stringify([l.conversationId, l.criterionId]);
    if (seen.has(key)) throw Error('Повтор ответа');
    seen.add(key);
  }
  for (const e of b.history) {
    if (!kit.conversations.some(c => c.id === e.conversationId) || !kit.checklist.criteria.some(c => c.id === e.criterionId)) throw Error('Некорректная история');
    if (e.label) {
      validateLabel(kit, e.label);
      if (e.label.conversationId !== e.conversationId || e.label.criterionId !== e.criterionId) throw Error('Некорректная история');
    }
  }
  return b;
}
export function labelsCsv(kit: Kit, labels: Label[]) {
  return toCsv([[...LABEL_COLUMNS], ...kit.conversations.flatMap(cv => kit.checklist.criteria.map(cr => {
    const l = labels.find(l => l.conversationId === cv.id && l.criterionId === cr.id);
    return [cv.id, cv.language, cv.channel, cr.id, l && !l.isNA ? String(l.value) : '', l?.isNA ? 'yes' : '', '', l?.evidence.join(';') ?? '', l?.inspectedRange ? `${l.inspectedRange.from}-${l.inspectedRange.to}` : '', l?.rationale ?? '', l?.uncertainty ?? '', l?.reviewer ?? '', l?.adjudicated ? 'yes' : ''];
  }))]);
}

export function installOffline(kit: Kit) {
  const prefix = 'cqa-offline-' + kit.id;
  const profilesKey = prefix + '-profiles';
  const activeKey = prefix + '-active';
  const profilesRaw = localStorage.getItem(profilesKey);
  const profiles = profilesRaw ? z.array(ProfileSchema).min(1).parse(JSON.parse(profilesRaw)) : [{ id: crypto.randomUUID(), name: 'Эльдана' }];
  const profile = profiles.find(p => p.id === localStorage.getItem(activeKey)) ?? profiles[0]!;
  localStorage.setItem(profilesKey, JSON.stringify(profiles));
  localStorage.setItem(activeKey, profile.id);
  const key = prefix + '-' + profile.id;
  let backup = { profile, kitId: kit.id, labels: [] as Label[], history: [] as z.infer<typeof EventSchema>[] };
  // Fail visibly rather than silently replacing unreadable or unavailable saved work.
  const raw = localStorage.getItem(key);
  if (raw) backup = validateBackup(kit, JSON.parse(raw));
  localStorage.setItem(key, JSON.stringify(backup));
  const persist = (next: typeof backup) => { localStorage.setItem(key, JSON.stringify(next)); backup = next; };
  const download = (name: string, data: string, type: string) => {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  Object.assign(window, {
    offlineApi: async (path: string, opts?: {method?: string; body?: unknown}) => {
      const url = new URL(path, 'http://offline');
      if (url.pathname === '/api/checklists') return [kit.checklist];
      if (url.pathname === '/api/conversations') return kit.conversations;
      if (url.pathname === '/api/labels/progress') return kit.conversations.map(cv => {
        const rows = backup.labels.filter(l => l.conversationId === cv.id);
        return { conversationId: cv.id, labeled: rows.length, total: kit.checklist.criteria.length, humanTotal: rows.length === kit.checklist.criteria.length ? computeTotal(kit.checklist.criteria, rows.map(l => ({ ...l, explanation: l.rationale, evidence: l.evidence.map(messageIndex => ({ messageIndex })), checkedRange: l.inspectedRange ?? undefined }))) : null };
      });
      if (url.pathname === '/api/labels') return backup.labels.filter(l => l.conversationId === url.searchParams.get('conversationId'));
      const m = /^\/api\/labels\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (!m) throw Error('Недоступно в автономном режиме');
      const conversationId = decodeURIComponent(m[1]!), criterionId = decodeURIComponent(m[2]!);
      const label = opts?.method === 'DELETE' ? null : validateLabel(kit, { ...(opts?.body as object), conversationId, criterionId, reviewer: backup.profile.name });
      persist({ ...backup, labels: [...backup.labels.filter(l => l.conversationId !== conversationId || l.criterionId !== criterionId), ...(label ? [label] : [])], history: [...backup.history, { at: new Date().toISOString(), conversationId, criterionId, label }] });
      return label;
    },
    offlineProfiles: profiles,
    offlineProfile: profile,
    offlineSwitch: (id: string) => { if (!profiles.some(p => p.id === id)) throw Error('Неизвестный рецензент'); localStorage.setItem(activeKey, id); location.reload(); },
    offlineNewProfile: (name: string) => {
      name = name.trim();
      if (!name || name.length > 100) throw Error('Введите имя (до 100 символов)');
      if (profiles.some(p => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw Error('Это имя уже есть в списке. Выберите его или уточните имя.');
      const next = {id: crypto.randomUUID(), name};
      localStorage.setItem(profilesKey, JSON.stringify([...profiles, next]));
      localStorage.setItem(activeKey, next.id); location.reload();
    },
    offlineCsv: () => download('labels-' + backup.profile.name.replace(/[^a-zа-яё0-9_-]/gi, '_') + '-' + profile.id.slice(0,8) + '.csv', '\uFEFF' + labelsCsv(kit, backup.labels), 'text/csv;charset=utf-8'),
    offlineBackup: () => download('backup-' + backup.profile.name.replace(/[^a-zа-яё0-9_-]/gi, '_') + '-' + profile.id.slice(0,8) + '.json', JSON.stringify(backup, null, 2), 'application/json'),
    offlineRestore: async (file: File) => {
      const next = validateBackup(kit, JSON.parse(await file.text()));
      if (backup.labels.length || backup.history.length) throw Error('В этом браузере уже есть работа. Сначала скачайте копию; создайте отдельного рецензента, чтобы не потерять историю.');
      const owner = profiles.find(p => p.id === profile.id)!;
      owner.name = next.profile.name;
      localStorage.setItem(profilesKey, JSON.stringify(profiles));
      persist({ ...next, profile: { ...next.profile, id: profile.id } }); location.reload();
    },
  });
}
