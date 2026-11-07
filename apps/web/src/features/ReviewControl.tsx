import { Check, RotateCcw, UserRoundCheck } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/error-note';
import { REVIEW_LABEL } from '@/lib/present';
import type { ReviewState } from '@/lib/queue';

type Props = {
  state: ReviewState;
  /** The dialog was evaluated again after it was checked. */
  stale: boolean;
  by?: string;
  at?: string;
  /** Nothing to check until the dialog has a completed evaluation. */
  disabled: boolean;
  onSet: (status: 'new' | 'in_review' | 'reviewed') => Promise<void>;
};

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '');

/** The reviewer's own state for a dialog: take it, finish it, reopen it. Overrides alone never finish a check. */
export function ReviewControl({ state, stale, by, at, disabled, onSet }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const run = async (status: 'new' | 'in_review' | 'reviewed') => {
    setBusy(status);
    setError(null);
    try {
      await onSet(status);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {state === 'new' && stale && <Badge tone="warn" title={`Проверено ${when(at)}: ${by}. С тех пор диалог оценён заново.`}>Оценка обновлена после проверки</Badge>}
      {state !== 'new' && <Badge tone={state === 'reviewed' ? 'success' : 'neutral'} title={`${by ?? ''} · ${when(at)}`}>{REVIEW_LABEL[state]}{by ? ` · ${by}` : ''}</Badge>}
      {state === 'new' && (
        <Button size="sm" disabled={disabled || busy !== null} onClick={() => void run('in_review')}><UserRoundCheck aria-hidden className="size-4" />Взять в работу</Button>
      )}
      {state !== 'reviewed' && (
        <Button variant="primary" size="sm" disabled={disabled || busy !== null} onClick={() => void run('reviewed')}><Check aria-hidden className="size-4" />Проверено</Button>
      )}
      {state !== 'new' && (
        <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void run('new')}><RotateCcw aria-hidden className="size-4" />Вернуть в новые</Button>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
