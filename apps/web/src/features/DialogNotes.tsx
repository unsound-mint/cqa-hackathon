import { can, ERROR_ORIGIN_LABELS, ErrorOriginSchema, type Actor, type Comment, type ErrorOrigin, type Tag, type TaxonomyItem } from '@cqa/contracts';
import { Check } from 'lucide-react';
import { useId, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/error-note';
import { Select } from '@/components/ui/field';

const fmt = (iso: string) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

/** Why points were lost, as the reviewer sees it: where the root is and which category. Tags never change a grade. */
export function CriterionTags({ identity, criterionId, tags, taxonomy, onAdd }: { identity: Actor; criterionId: string; tags: Tag[]; taxonomy: TaxonomyItem[]; onAdd: (origin: ErrorOrigin, label?: string) => Promise<void> }) {
  const list = useId();
  const [origin, setOrigin] = useState<ErrorOrigin>('operator');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<unknown>(null);
  const mine = tags.filter((t) => t.criterionId === criterionId);
  const canTag = can(identity, 'tag');
  if (mine.length === 0 && !canTag) return null;
  const options = taxonomy.filter((t) => !t.criterionId || t.criterionId === criterionId);
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <p className="text-xs font-medium text-muted">Причина ошибки</p>
      {mine.length > 0 && <ul className="flex flex-wrap gap-2">{mine.map((t) => <li key={t.id}><Badge title={`${t.by} · ${fmt(t.at)}`}>{ERROR_ORIGIN_LABELS[t.origin]}{t.label ? ` · ${t.label}` : ''}</Badge></li>)}</ul>}
      {canTag && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); setError(null); onAdd(origin, label.trim() || undefined).then(() => setLabel(''), setError); }}>
          <Select aria-label="Где корень проблемы" value={origin} onChange={(e) => setOrigin(ErrorOriginSchema.parse(e.target.value))} className="h-8 w-auto rounded-full border-transparent bg-fill pl-3 pr-8 text-sm">{ErrorOriginSchema.options.map((o) => <option key={o} value={o}>{ERROR_ORIGIN_LABELS[o]}</option>)}</Select>
          <input aria-label="Категория ошибки" list={list} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Категория (необязательно)" title="Категория (необязательно)" className="h-8 min-w-56 flex-1 rounded-full border border-transparent bg-fill px-3 text-sm placeholder:text-muted" />
          <datalist id={list}>{options.map((t) => <option key={t.id} value={t.label} />)}</datalist>
          <Button type="submit" size="sm">Отметить</Button>
        </form>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

/** Coaching comments on the dialog: written by QA or managers, read and acknowledged by the operator. */
export function DialogComments({ identity, conversationId, comments, onAdd, onAck }: { identity: Actor; conversationId: string; comments: Comment[]; onAdd: (body: string) => Promise<void>; onAck: (id: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<unknown>(null);
  const mine = comments.filter((c) => c.conversationId === conversationId && !c.criterionId);
  const canWrite = can(identity, 'comment');
  if (mine.length === 0 && !canWrite) return null;
  return (
    <section aria-label="Комментарии к работе" className="space-y-2 border-t border-line px-4 py-3">
      <h3 className="text-sm font-semibold">Комментарии к работе</h3>
      {mine.length === 0 && <p className="text-xs text-muted">Комментариев пока нет.</p>}
      <ul className="space-y-2">
        {mine.map((c) => (
          <li key={c.id} className="rounded-xl bg-canvas px-3 py-2 text-sm">
            <p className="text-xs text-muted">{c.authorName} · {fmt(c.createdAt)}</p>
            <p className="max-w-[65ch]">{c.body}</p>
            {c.ackedAt ? <p className="mt-1 flex items-center gap-1 text-xs text-accent"><Check aria-hidden className="size-4" />Ознакомлен {fmt(c.ackedAt)}</p> : identity.role === 'operator' ? <Button size="sm" className="mt-1" onClick={() => void onAck(c.id).catch(setError)}>Ознакомлен</Button> : <p className="mt-1 text-xs text-muted">Оператор ещё не ознакомился</p>}
          </li>
        ))}
      </ul>
      {canWrite && (
        <form data-draft={text.trim() ? 'dirty' : undefined} className="space-y-2" onSubmit={(e) => { e.preventDefault(); setError(null); onAdd(text.trim()).then(() => setText(''), setError); }}>
          <label htmlFor="comment-text" className="sr-only">Комментарий оператору</label>
          <textarea id="comment-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Комментарий оператору: что получилось, что улучшить" className="min-h-16 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" />
          <Button type="submit" size="sm" disabled={!text.trim()}>Отправить комментарий</Button>
        </form>
      )}
      <ErrorNote error={error} />
    </section>
  );
}
