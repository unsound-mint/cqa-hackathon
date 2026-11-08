import type { Person } from '@cqa/contracts';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';

type Props = {
  /** Operators of the directory: dialogs are assigned to a person, not to a typed name. */
  operators: Person[];
  /** The dialog's current operator (person id). */
  current?: string | null;
  submitLabel?: string;
  onAssign: (operatorId: string | null) => Promise<void>;
  compact?: boolean;
};

/** The lead or admin names the operator a dialog belongs to (the organizer data has no operator identity). */
export function AssignOperator({ operators, current = '', submitLabel = 'Назначить', onAssign, compact }: Props) {
  const [id, setId] = useState(current ?? '');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async (operator: string | null) => {
    setBusy(true);
    setFailed(false);
    try {
      await onAssign(operator);
      if (operator === null) setId('');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (id) void run(id);
  };
  if (operators.length === 0) return <p className="text-xs text-muted">Нет операторов в справочнике: добавьте их в разделе «Команда».</p>;
  return (
    <form onSubmit={submit} aria-label="Назначить оператора" className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="assign-operator">Оператор</label>
      <Select id="assign-operator" value={id} onChange={(e) => setId(e.target.value)} className="h-8 w-48 rounded-full border-transparent bg-fill pl-3 pr-8 text-sm">
        <option value="">Оператор…</option>
        {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </Select>
      <Button type="submit" size="sm" disabled={busy || !id || id === (current ?? '')}>{submitLabel}</Button>
      {!compact && current && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run(null)}>Снять</Button>}
      {failed && <span role="alert" className="text-xs text-danger">Не удалось назначить</span>}
    </form>
  );
}
