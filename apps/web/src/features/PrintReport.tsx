import type { ChecklistVersion, Conversation, Evaluation } from '@cqa/contracts';
import { SPEAKER_LABEL, earnedPoints, formatScore, outcome } from '@/lib/present';

/** Paper version of one evaluation (browser "Save as PDF"): shown only when printing, the app itself is hidden then. */
export function PrintReport({ conversation, evaluation, checklist }: { conversation: Conversation; evaluation: Evaluation; checklist: ChecklistVersion | undefined }) {
  const originals = new Map(evaluation.originalResults.map((r) => [r.criterionId, r]));
  return (
    <article aria-hidden className="hidden bg-white p-0 text-sm leading-5 text-black print:block">
      <h1 className="text-2xl font-semibold leading-8">Оценка диалога {conversation.id}</h1>
      <p>{conversation.language} · {conversation.channel === 'voice call' ? 'звонок' : 'чат'} · {conversation.transcript.length} сообщений{checklist ? ` · чек-лист «${checklist.title}», версия ${checklist.version}` : ''}</p>
      <p className="mt-2 text-xl font-semibold">Итоговый балл: {formatScore(evaluation.finalTotal)} из 100</p>
      {evaluation.originalTotal !== evaluation.finalTotal && <p>Исходная оценка ИИ: {formatScore(evaluation.originalTotal)}</p>}
      <p className="mt-1 font-medium">{evaluation.seriousViolation ? 'Грубое нарушение выявлено' : 'Грубых нарушений нет'}</p>
      {evaluation.provenance?.provider === 'mock' && <p className="mt-1 italic">Демо-данные: вымышленный пример, а не оценка модели.</p>}

      <table className="mt-4 w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-black">
            <th className="py-1 pr-2">№</th><th className="py-1 pr-2">Критерий</th><th className="py-1 pr-2">Вес</th><th className="py-1 pr-2">Ответ</th><th className="py-1 pr-2">Баллы</th><th className="py-1">Обоснование</th>
          </tr>
        </thead>
        <tbody>
          {evaluation.finalResults.map((r) => {
            const c = checklist?.criteria.find((x) => x.id === r.criterionId);
            const o = originals.get(r.criterionId);
            const changed = o && outcome(c, o).label !== outcome(c, r).label;
            const pts = earnedPoints(c, r);
            return (
              <tr key={r.criterionId} className="break-inside-avoid border-b border-neutral-300 align-top">
                <td className="py-1 pr-2 tabular-nums">{r.criterionId}</td>
                <td className="py-1 pr-2 font-medium">{c?.title ?? ''}</td>
                <td className="py-1 pr-2 tabular-nums">{c?.weight ?? ''}</td>
                <td className="py-1 pr-2">{outcome(c, r).label}{changed && o ? ` (ИИ: ${outcome(c, o).label})` : ''}</td>
                <td className="py-1 pr-2 tabular-nums">{pts ?? '—'}</td>
                <td className="py-1">
                  {r.isNA && r.naReason ? <span>N/A: {r.naReason} </span> : null}
                  {r.explanation}
                  {r.evidence.length > 0 && <span className="block text-xs">{r.evidence.map((e) => `#${e.messageIndex}${e.quote ? ` «${e.quote}»` : ''}`).join('; ')}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 className="mt-6 text-base font-semibold">Транскрипт</h2>
      <ol className="mt-2 space-y-1" start={0}>
        {conversation.transcript.map((m) => (
          <li key={m.index} className="break-inside-avoid">
            <span className="tabular-nums">#{m.index} {m.timestamp}</span> <strong>{SPEAKER_LABEL[m.speaker]}:</strong> {m.text}
          </li>
        ))}
      </ol>
    </article>
  );
}
