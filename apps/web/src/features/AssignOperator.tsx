import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';

type Props = {
  operators: string[];
  /** Name shown as the starting value (a single dialog's current operator). */
  current?: string | null;
  /** Label for the button; the bulk form says how many dialogs it covers. */
  submitLabel?: string;
  onAssign: (operator: string | null) => Promise<void>;
  compact?: boolean;
};

/** The lead names the operator a dialog belongs to (the organizer data has no operator identity). */
export function AssignOperator({ operators, current = '', submitLabel = 'Назначить', onAssign, compact }: Props) {
  const list = useId();
  const [name, setName] = useState(current ?? '');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async (operator: string | null) => {
    setBusy(true);
    setFailed(false);
    try {
      await onAssign(operator);
      if (operator === null) setName('');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) void run(name.trim());
  };
  return (
    <form onSubmit={submit} aria-label="Назначить оператора" data-draft={name.trim() !== (current ?? '') ? 'dirty' : undefined} className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`${list}-name`}>Оператор</label>
      <input id={`${list}-name`} list={list} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Оператор" className="h-8 w-40 rounded-full border border-transparent bg-fill px-3 text-sm placeholder:text-muted" />
      <datalist id={list}>{operators.map((o) => <option key={o} value={o} />)}</datalist>
      <Button type="submit" size="sm" disabled={busy || !name.trim() || name.trim() === (current ?? '')}>{submitLabel}</Button>
      {!compact && current && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run(null)}>Снять</Button>}
      {failed && <span role="alert" className="text-xs text-danger">Не удалось назначить</span>}
    </form>
  );
}
