import type { Appeal, ChecklistVersion, Conversation, Evaluation } from '@cqa/contracts';
import { SPEAKER_LABEL, formatScore, grade, sameResult } from '@/lib/present';

const fmt = (iso: string) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

/** Paper version of one evaluation (browser "Save as PDF"): shown only when printing, the app itself is hidden then. */
export function PrintReport({ conversation, evaluation, checklist, appeals }: { conversation: Conversation; evaluation: Evaluation; checklist: ChecklistVersion | undefined; appeals: Appeal[] }) {
  const decided = appeals.filter((a) => a.status !== 'pending');
  const originals = new Map(evaluation.originalResults.map((r) => [r.criterionId, r]));
  return (
    <article aria-hidden className="hidden bg-white p-0 text-sm leading-5 text-black print:block">
      <h1 className="text-2xl font-semibold leading-8">Оценка диалога {conversation.id}</h1>
      <p>{conversation.language} · {conversation.channel === 'voice call' ? 'звонок' : 'чат'} · {conversation.transcript.length} сообщений{checklist ? ` · чек-лист «${checklist.title}», версия ${checklist.version}` : ''}</p>
      <p className="mt-2 text-xl font-semibold">Итоговый балл: {formatScore(evaluation.finalTotal)} из 100</p>
      {evaluation.originalTotal !== evaluation.finalTotal && <p>Исходная оценка ИИ: {formatScore(evaluation.originalTotal)}</p>}
      <p className="mt-1 font-medium">{evaluation.seriousViolation ? 'Грубое нарушение выявлено' : 'Грубых нарушений нет'}</p>
      {evaluation.provenance?.provider === 'mock' ? (
        <p className="mt-1 italic">Демо-данные: вымышленный пример, а не оценка модели.</p>
      ) : evaluation.provenance ? (
        <p className="mt-1">Модель: {evaluation.provenance.provider} / {evaluation.provenance.model} · версия промпта {evaluation.provenance.promptVersion}</p>
      ) : null}
      <p>Отчёт сформирован {fmt(new Date().toISOString())}</p>

      <table className="mt-4 w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-black">
            <th className="py-1 pr-2">№</th><th className="py-1 pr-2">Критерий</th><th className="py-1 pr-2">Баллы</th><th className="py-1">Обоснование</th>
          </tr>
        </thead>
        <tbody>
          {evaluation.finalResults.map((r) => {
            const c = checklist?.criteria.find((x) => x.id === r.criterionId);
            const o = originals.get(r.criterionId);
            const changed = !!o && !sameResult(o, r);
            return (
              <tr key={r.criterionId} className="break-inside-avoid border-b border-neutral-300 align-top">
                <td className="py-1 pr-2 tabular-nums">{r.criterionId}</td>
                <td className="py-1 pr-2 font-medium">{c?.title ?? ''}</td>
                <td className="py-1 pr-2 tabular-nums whitespace-nowrap">{grade(c, r).label}{changed && o ? ` (ИИ: ${grade(c, o).label})` : ''}</td>
                <td className="py-1">
                  {changed && o ? (
                    <>
                      <span className="block"><strong>Проверяющий:</strong> {r.explanation.replace(/^Reviewer override: /, '')}</span>
                      <span className="block"><strong>ИИ:</strong> {o.explanation}</span>
                    </>
                  ) : (
                    <>
                      {r.isNA && r.naReason ? <span>N/A: {r.naReason} </span> : null}
                      {r.explanation}
                    </>
                  )}
                  {r.evidence.length > 0 && <span className="block text-xs">{r.evidence.map((e) => `#${e.messageIndex}${e.quote ? ` «${e.quote}»` : ''}`).join('; ')}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {decided.length > 0 && (
        <>
          <h2 className="mt-6 text-base font-semibold">Решения проверяющих</h2>
          <ul className="mt-2 space-y-1">
            {decided.map((a) => (
              <li key={a.id} className="break-inside-avoid">
                <span className="tabular-nums">{a.decidedAt ? fmt(a.decidedAt) : ''}</span> · критерий {a.criterionId} · {a.kind === 'correction' ? 'исправление' : a.status === 'upheld' ? 'апелляция, оценка ИИ оставлена' : 'апелляция, оценка изменена'}
                {a.comment && <span className="block">Возражение: {a.comment}</span>}
                {a.reviewerReason && <span className="block">Обоснование: {a.reviewerReason}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

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
