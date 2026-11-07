import type { ChecklistVersion, Conversation, Criterion, CriterionResult, EvidenceReference, Evaluation } from '@cqa/contracts';
import { AlertTriangle, FlaskConical, Link2Off, Loader2, Quote, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CONFIDENCE_LABEL, SOURCE_LABEL, formatScore, outcome, sameResult } from '@/lib/present';

type Props = {
  conversation: Conversation;
  evaluation: Evaluation | undefined;
  checklist: ChecklistVersion | undefined;
  selectedCriterionId: string | null;
  onSelectCriterion: (id: string) => void;
  onJump: (index: number) => void;
  onStart: () => void;
  starting: boolean;
  startError: string | null;
};

/** Evidence the transcript cannot back up is shown as unavailable instead of scrolling to a wrong message. */
function evidenceProblem(c: Conversation, e: EvidenceReference): string | null {
  const m = c.transcript[e.messageIndex];
  if (!m) return `Сообщения #${e.messageIndex} нет в транскрипте`;
  if (e.quote !== undefined && !m.text.includes(e.quote)) return `Цитата не найдена в сообщении #${e.messageIndex}`;
  return null;
}

function EvidenceChip({ e, conversation, onJump }: { e: EvidenceReference; conversation: Conversation; onJump: (i: number) => void }) {
  const problem = evidenceProblem(conversation, e);
  if (problem) {
    return (
      <span role="note" title={problem} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-danger-soft px-2 py-1 text-xs text-danger">
        <Link2Off aria-hidden className="size-3.5 shrink-0" />#{e.messageIndex}: {problem}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onJump(e.messageIndex);
      }}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2 py-1 text-left text-xs transition-colors hover:border-brand-dark hover:bg-brand-soft"
      aria-label={`Перейти к сообщению ${e.messageIndex}${e.quote ? `: ${e.quote}` : ''}`}
    >
      <Quote aria-hidden className="size-3.5 shrink-0 text-brand-dark" />
      <span className="shrink-0 font-mono font-semibold">#{e.messageIndex}</span>
      {e.quote && <span className="truncate text-muted">«{e.quote}»</span>}
    </button>
  );
}

function CriterionCard({ criterion, result, original, conversation, selected, onSelect, onJump }: { criterion: Criterion | undefined; result: CriterionResult; original: CriterionResult | undefined; conversation: Conversation; selected: boolean; onSelect: () => void; onJump: (i: number) => void }) {
  const o = outcome(criterion, result);
  const changed = original && !sameResult(original, result);
  const tone = { neutral: 'bg-canvas text-ink ring-line-strong', success: 'bg-brand-soft text-brand-dark ring-brand/40', danger: 'bg-danger-soft text-danger ring-danger/30', warn: 'bg-warn-soft text-warn ring-warn/30' }[o.tone];
  return (
    <li>
      <div className={cn('rounded-card border bg-surface transition-shadow', selected ? 'border-brand-dark shadow-[0_0_0_2px_var(--color-brand)]' : 'border-line')}>
        <button type="button" onClick={onSelect} aria-pressed={selected} className="flex w-full items-start justify-between gap-3 rounded-card px-3 pb-2 pt-3 text-left">
          <span className="min-w-0">
            <span className="block text-xs text-muted">
              Критерий {result.criterionId}
              {criterion && criterion.weight > 0 ? ` · вес ${criterion.weight}` : criterion?.criticalFlag ? ' · флаг, без баллов' : ''}
            </span>
            <span className="block font-medium leading-snug">{criterion?.title ?? 'Критерий не найден в чек-листе'}</span>
          </span>
          <span className={cn('shrink-0 rounded-md px-2.5 py-1 text-sm font-semibold ring-1 ring-inset', tone)}>{o.label}</span>
        </button>

        <div className="space-y-2.5 px-3 pb-3">
          {changed && original && (
            <p className="flex items-center gap-1.5 rounded-md bg-warn-soft px-2 py-1 text-xs text-warn">
              <AlertTriangle aria-hidden className="size-3.5" />
              Изменено ревьюером. Исходный ответ ИИ: <strong>{outcome(criterion, original).label}</strong>
            </p>
          )}
          {result.isNA && result.naReason && <p className="text-sm"><span className="font-medium">Причина N/A:</span> {result.naReason}</p>}
          <p className="text-sm leading-relaxed text-ink/90">{result.explanation}</p>

          {result.evidence.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label="Доказательства">
              {result.evidence.map((e, i) => (
                <EvidenceChip key={`${e.messageIndex}-${i}`} e={e} conversation={conversation} onJump={onJump} />
              ))}
            </div>
          )}
          {result.checkedRange && result.evidence.length === 0 && (
            <p className="text-xs text-muted">
              Проверены сообщения #{result.checkedRange.from}–#{result.checkedRange.to}: подтверждающих реплик не найдено.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {result.source && <Badge tone={result.source === 'model' ? 'neutral' : 'success'}>{SOURCE_LABEL[result.source]}</Badge>}
            {result.reusedFrom && <Badge>Из прошлой оценки</Badge>}
            {result.confidence && <Badge tone={result.confidence === 'low' ? 'warn' : 'neutral'}>Уверенность: {CONFIDENCE_LABEL[result.confidence]}</Badge>}
            {result.confidence === 'low' && <span className="text-xs text-warn">Нужна проверка человеком</span>}
          </div>

          {criterion && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer select-none hover:text-ink">Как оценивается критерий</summary>
              <p className="mt-1 leading-relaxed">{criterion.instructions}</p>
            </details>
          )}
        </div>
      </div>
    </li>
  );
}

export function EvaluationPanel({ conversation, evaluation, checklist, selectedCriterionId, onSelectCriterion, onJump, onStart, starting, startError }: Props) {
  const lookup = (id: string) => checklist?.criteria.find((c) => c.id === id);

  if (!evaluation) {
    return (
      <section aria-label="Оценка" className="flex h-full flex-col items-start gap-3 p-5">
        <h2 className="text-base font-semibold">Диалог ещё не оценён</h2>
        <p className="max-w-prose text-sm text-muted">Оценки нет, и мы не показываем выдуманных. Запустите оценку по текущему чек-листу.</p>
        <Button variant="primary" onClick={onStart} disabled={starting || !checklist}>
          {starting && <Loader2 aria-hidden className="size-4 animate-spin" />}
          {starting ? 'Идёт оценка…' : 'Оценить диалог'}
        </Button>
        {startError && <p role="alert" className="text-sm text-danger">{startError}</p>}
      </section>
    );
  }

  if (evaluation.status === 'failed') {
    return (
      <section aria-label="Оценка" className="flex h-full flex-col items-start gap-3 p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-danger"><AlertTriangle aria-hidden className="size-5" />Оценка не получилась</h2>
        <p className="max-w-prose text-sm">{evaluation.error ?? 'Причина не указана.'}</p>
        <Button variant="primary" onClick={onStart} disabled={starting}>{starting ? 'Идёт оценка…' : 'Повторить оценку'}</Button>
        {startError && <p role="alert" className="text-sm text-danger">{startError}</p>}
      </section>
    );
  }

  if (evaluation.status !== 'completed') {
    return (
      <section aria-label="Оценка" className="flex h-full items-center gap-2 p-5 text-sm text-muted" role="status">
        <Loader2 aria-hidden className="size-4 animate-spin" />Оценка выполняется…
      </section>
    );
  }

  const isMock = evaluation.provenance?.provider === 'mock';
  const originalById = new Map(evaluation.originalResults.map((r) => [r.criterionId, r]));
  const totalChanged = evaluation.originalTotal !== evaluation.finalTotal;
  const sections = checklist?.sections ?? [];
  const groups = sections.length
    ? [...sections.map((s) => ({ id: s.id, title: s.title, rows: evaluation.finalResults.filter((r) => lookup(r.criterionId)?.sectionId === s.id) })), { id: '_', title: 'Прочее', rows: evaluation.finalResults.filter((r) => !sections.some((s) => s.id === lookup(r.criterionId)?.sectionId)) }].filter((g) => g.rows.length)
    : [{ id: '_', title: '', rows: evaluation.finalResults }];

  return (
    <section aria-label="Оценка" className="flex h-full min-h-0 flex-col">
      {isMock && (
        <p className="flex items-center gap-2 bg-warn-soft px-4 py-2 text-xs text-warn" role="note">
          <FlaskConical aria-hidden className="size-4 shrink-0" />
          Демо-данные: вымышленный пример, а не оценка модели.
        </p>
      )}
      <header className="border-b border-line px-4 py-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs text-muted">Итоговый балл</p>
            <p className="text-4xl font-semibold tabular-nums leading-none">
              {formatScore(evaluation.finalTotal)}
              <span className="ml-1 text-base font-normal text-muted">/ 100</span>
            </p>
            {totalChanged && <p className="mt-1 text-xs text-muted">Исходная оценка ИИ: {formatScore(evaluation.originalTotal)}</p>}
            {evaluation.finalTotal === null && <p className="mt-1 text-xs text-muted">Нет применимых критериев: балл не считается.</p>}
          </div>
          {evaluation.seriousViolation ? (
            <Badge tone="danger" className="px-3 py-1 text-sm"><ShieldAlert aria-hidden className="size-4" />Грубое нарушение</Badge>
          ) : (
            <Badge tone="success">Грубых нарушений нет</Badge>
          )}
        </div>
        <p className="mt-3 text-xs text-muted">
          Чек-лист: {checklist ? `${checklist.title}, версия ${checklist.version}` : evaluation.checklistVersionId}
          {evaluation.provenance && !isMock && <> · {evaluation.provenance.model} · {evaluation.provenance.promptVersion}</>}
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {groups.map((g) => (
          <div key={g.id}>
            {g.title && <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</h3>}
            <ul className="space-y-2.5">
              {g.rows.map((r) => (
                <CriterionCard
                  key={r.criterionId}
                  criterion={lookup(r.criterionId)}
                  result={r}
                  original={originalById.get(r.criterionId)}
                  conversation={conversation}
                  selected={selectedCriterionId === r.criterionId}
                  onSelect={() => onSelectCriterion(r.criterionId)}
                  onJump={onJump}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
