import type { ChecklistVersion, Conversation, Crosscheck, CriterionResult, CriterionValue, Evaluation, Task } from '@cqa/contracts';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/error-note';
import { PlayerProvider } from '@/lib/player';
import { grade } from '@/lib/present';
import { Transcript } from './Transcript';

type Props = {
  task: Task;
  conversation: Conversation;
  evaluation: Evaluation;
  checklist: ChecklistVersion;
  onSubmit: (results: { criterionId: string; value: CriterionValue | null; isNA: boolean }[]) => Promise<void>;
  /** Set after the answer was sent: the page then shows how it compares with the first review. */
  submitted?: Crosscheck;
  onBack: () => void;
};

const probe = (criterionId: string, value: CriterionValue | null, isNA: boolean): CriterionResult => ({ criterionId, value, isNA, explanation: '', evidence: [] });

/**
 * Blind re-grade: the transcript and the criteria, nothing about what the AI or the first reviewer answered. The
 * answer is the checker's own. Only after sending is the comparison with the first review shown.
 */
export function CrosscheckPage({ task, conversation, evaluation, checklist, onSubmit, submitted, onBack }: Props) {
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
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const answerText = (c: (typeof criteria)[number], r: { value: CriterionValue | null; isNA: boolean } | undefined) => (r ? grade(c, { criterionId: c!.id, value: r.value, isNA: r.isNA, explanation: '', evidence: [] }).label : '—');
  const same = (a: { value: unknown; isNA: boolean } | undefined, b: { value: unknown; isNA: boolean } | undefined) => !!a && !!b && a.isNA === b.isNA && a.value === b.value;
  const compared = submitted ? criteria.map((c) => {
    const mine = submitted.results.find((r) => r.criterionId === c!.id);
    const first = evaluation.finalResults.find((r) => r.criterionId === c!.id);
    return { c, mine, first, agree: same(mine, first) };
  }) : [];
  const agreed = compared.filter((x) => x.agree).length;
  return (
    <PlayerProvider conversation={conversation}>
      <main id="content" tabIndex={-1} className="grid min-h-0 flex-1 gap-4 bg-canvas p-0 outline-none xl:grid-cols-[minmax(28rem,1fr)_30rem] xl:p-4">
        <div className="flex min-h-0 flex-col bg-surface xl:rounded-card xl:shadow-card">
          <Transcript conversation={conversation} cited={new Set()} focus={null} tags={new Map()} activeId={null} onTag={() => {}} toolbar={<div className="flex items-center gap-3"><Button variant="ghost" size="sm" aria-label="К задачам" onClick={onBack} className="-ml-3"><ArrowLeft aria-hidden className="size-4" /></Button><h1 className="text-2xl font-semibold leading-8">{conversation.id}</h1><p className="text-sm text-muted">контрольная проверка</p></div>} />
        </div>
        <section aria-label="Контрольная проверка" className="flex min-h-0 flex-col overflow-hidden bg-surface xl:rounded-card xl:shadow-card">
          <div className="border-b border-line p-4">
            <h2 className="text-base font-semibold">Ваша оценка</h2>
            <p className="text-xs text-muted">{submitted ? 'Теперь видно, как ваш ответ соотносится с первой проверкой.' : 'Вслепую: ответы ИИ и первого проверяющего скрыты. Оцените каждый критерий сами по транскрипту.'}</p>
          </div>
          {submitted ? (
            <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
              <p role="status" className="text-base font-semibold">Проверка отправлена. Совпало с первой проверкой: <span className="tabular-nums">{agreed} из {compared.length}</span>{compared.length > 0 && <span className="tabular-nums"> ({Math.round((agreed / compared.length) * 100)}%)</span>}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Сравнение с первой проверкой</caption>
                  <thead className="text-xs text-muted shadow-[0_1px_0_var(--c-line)]"><tr className="h-8 text-left"><th scope="col" className="pr-3 font-medium">Критерий</th><th scope="col" className="pr-3 font-medium">Ваш ответ</th><th scope="col" className="pr-3 font-medium">Первая проверка</th><th scope="col" className="font-medium">Итог</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {compared.map(({ c, mine, first, agree }) => (
                      <tr key={c!.id} className="align-top">
                        <th scope="row" className="py-2 pr-3 text-left font-normal"><span className="mr-2 tabular-nums text-muted">{c!.id}</span>{c!.title}</th>
                        <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{answerText(c, mine)}</td>
                        <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{answerText(c, first)}</td>
                        <td className="py-2"><span className={agree ? 'text-accent' : 'font-medium text-warn'}>{agree ? 'Совпало' : 'Расходится'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
            {criteria.map((c) => (
              <fieldset key={c!.id} className="space-y-1">
                <legend className="text-sm font-medium"><span className="mr-2 tabular-nums text-muted">{c!.id}</span>{c!.title}</legend>
                <details className="text-xs text-muted"><summary className="cursor-pointer select-none hover:text-ink">Как оценивается</summary><p className="mt-1 max-w-[65ch]">{c!.instructions}</p></details>
                {[...c!.allowedValues.map((v, i) => ({ key: String(i), label: grade(c, probe(c!.id, v, false)).label })), ...(c!.allowNA ? [{ key: 'na', label: 'N/A' }] : [])].map((o) => (
                  <label key={o.key} className="flex min-h-8 items-center gap-3 rounded-lg px-3 text-sm hover:bg-fill">
                    <input type="radio" name={`cc-${c!.id}`} checked={picked[c!.id] === o.key} onChange={() => setPicked((p) => ({ ...p, [c!.id]: o.key }))} className="size-4 accent-brand" />{o.label}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          )}
          <div className="space-y-2 border-t border-line p-4">
            <ErrorNote error={error} />
            {submitted ? <Button variant="primary" onClick={onBack}>К задачам</Button> : <Button variant="primary" disabled={!ready || busy} onClick={() => void submit()}>{busy ? 'Сохранение…' : 'Отправить проверку'}</Button>}
          </div>
        </section>
      </main>
    </PlayerProvider>
  );
}
