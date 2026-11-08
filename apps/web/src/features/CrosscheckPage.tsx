import type { ChecklistVersion, Conversation, CriterionResult, CriterionValue, Evaluation, Task } from '@cqa/contracts';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/error-note';
import { PlayerProvider } from '@/lib/player';
import { outcome } from '@/lib/present';
import { Transcript } from './Transcript';

type Props = {
  task: Task;
  conversation: Conversation;
  evaluation: Evaluation;
  checklist: ChecklistVersion;
  onSubmit: (results: { criterionId: string; value: CriterionValue | null; isNA: boolean }[]) => Promise<void>;
  onBack: () => void;
};

const probe = (criterionId: string, value: CriterionValue | null, isNA: boolean): CriterionResult => ({ criterionId, value, isNA, explanation: '', evidence: [] });

/**
 * Blind re-grade: the transcript and the criteria, nothing about what the AI or the first reviewer answered. The
 * answer is the checker's own; agreement is computed afterwards in the analytics, never shown here.
 */
export function CrosscheckPage({ task, conversation, evaluation, checklist, onSubmit, onBack }: Props) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ids = evaluation.finalResults.map((r) => r.criterionId);
  const criteria = ids.map((id) => checklist.criteria.find((c) => c.id === id)).filter((c) => !!c);
  const ready = criteria.every((c) => picked[c!.id] !== undefined);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(criteria.map((c) => {
        const k = picked[c!.id]!;
        return k === 'na' ? { criterionId: c!.id, value: null, isNA: true } : { criterionId: c!.id, value: c!.allowedValues[Number(k)]!, isNA: false };
      }));
      onBack();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <PlayerProvider conversation={conversation}>
      <main id="content" tabIndex={-1} className="grid min-h-0 flex-1 gap-4 bg-canvas p-0 outline-none xl:grid-cols-[minmax(28rem,1fr)_30rem] xl:p-4">
        <div className="flex min-h-0 flex-col bg-surface xl:rounded-card xl:shadow-card">
          <Transcript conversation={conversation} cited={new Set()} focus={null} tags={new Map()} activeId={null} onTag={() => {}} toolbar={<div className="flex items-center gap-3"><Button variant="ghost" size="sm" aria-label="К задачам" onClick={onBack} className="-ml-3"><ArrowLeft aria-hidden className="size-4" /></Button><h1 className="text-2xl font-semibold leading-8">{conversation.id}</h1><p className="text-sm text-muted">контрольная проверка</p></div>} />
        </div>
        <section aria-label="Контрольная проверка" className="flex min-h-0 flex-col overflow-hidden bg-surface xl:rounded-card xl:shadow-card">
          <div className="border-b border-line p-4">
            <h2 className="text-base font-semibold">Ваша оценка</h2>
            <p className="text-xs text-muted">Вслепую: ответы ИИ и первого проверяющего скрыты. Оцените каждый критерий сами по транскрипту.</p>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
            {criteria.map((c) => (
              <fieldset key={c!.id} className="space-y-1">
                <legend className="text-sm font-medium"><span className="mr-2 tabular-nums text-muted">{c!.id}</span>{c!.title}</legend>
                <details className="text-xs text-muted"><summary className="cursor-pointer select-none hover:text-ink">Как оценивается</summary><p className="mt-1 max-w-[65ch]">{c!.instructions}</p></details>
                {[...c!.allowedValues.map((v, i) => ({ key: String(i), label: outcome(c, probe(c!.id, v, false)).label })), ...(c!.allowNA ? [{ key: 'na', label: 'N/A' }] : [])].map((o) => (
                  <label key={o.key} className="flex min-h-8 items-center gap-3 rounded-lg px-3 text-sm hover:bg-fill">
                    <input type="radio" name={`cc-${c!.id}`} checked={picked[c!.id] === o.key} onChange={() => setPicked((p) => ({ ...p, [c!.id]: o.key }))} className="size-4 accent-brand" />{o.label}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <div className="space-y-2 border-t border-line p-4">
            <ErrorNote error={error} />
            <Button variant="primary" disabled={!ready || busy} onClick={() => void submit()}>{busy ? 'Сохранение…' : 'Отправить проверку'}</Button>
          </div>
        </section>
      </main>
    </PlayerProvider>
  );
}
