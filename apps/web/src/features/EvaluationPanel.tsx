import type { Appeal, ChecklistVersion, Conversation, Criterion, CriterionResult, DecideAppealInput, EvidenceReference, Evaluation } from '@cqa/contracts';
import { AlertTriangle, ChevronDown, FlaskConical, Link2Off, Loader2, Quote, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { CONFIDENCE_LABEL, SOURCE_LABEL, earnedPoints, formatScore, needsReview, outcome, sameResult, shortOutcome } from '@/lib/present';
import { violationReasons } from '@/lib/queue';
import { AppealBox } from './Appeals';

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
  /** Appeals of this evaluation, and the handlers that file/decide them. */
  appeals: Appeal[];
  onCreateAppeal: (criterionId: string, comment: string) => Promise<void>;
  onDecideAppeal: (input: DecideAppealInput) => Promise<void>;
  /** All evaluations of this conversation (oldest first) so a checklist change can be compared with the old result. */
  versions: { id: string; label: string }[];
  onPickEvaluation: (id: string) => void;
  /** Set when a newer checklist version exists than the one this evaluation used. */
  newerChecklistVersion: number | null;
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
      <span role="note" title={problem} className="inline-flex max-w-full items-center gap-2 rounded-full bg-danger-soft px-3 py-2 text-xs text-danger">
        <Link2Off aria-hidden className="size-4 shrink-0" />#{e.messageIndex}: {problem}
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
      className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-full border border-line-strong bg-surface px-3 text-left text-sm transition-colors hover:border-accent hover:bg-brand-soft"
      aria-label={`Перейти к сообщению ${e.messageIndex}${e.quote ? `: ${e.quote}` : ''}`}
    >
      <Quote aria-hidden className="size-4 shrink-0 text-accent" />
      <span className="shrink-0 font-semibold tabular-nums">#{e.messageIndex}</span>
      {e.quote && <span className="truncate text-muted">«{e.quote}»</span>}
    </button>
  );
}

const CHIP = { neutral: 'bg-fill text-ink', success: 'bg-brand-soft text-accent', danger: 'bg-danger-soft text-danger', warn: 'bg-warn-soft text-warn' } as const;
const BAR = { neutral: 'bg-line-strong', success: 'bg-brand', danger: 'bg-danger', warn: 'bg-warn' } as const;

type RowProps = { criterion: Criterion | undefined; result: CriterionResult; original: CriterionResult | undefined; conversation: Conversation; open: boolean; onToggle: () => void; onJump: (i: number) => void; evaluationId: string; appeals: Appeal[]; onCreateAppeal: Props['onCreateAppeal']; onDecideAppeal: Props['onDecideAppeal'] };

function CriterionRow({ criterion, result, original, conversation, open, onToggle, onJump, evaluationId, appeals, onCreateAppeal, onDecideAppeal }: RowProps) {
  const o = outcome(criterion, result);
  const changed = !!original && !sameResult(original, result);
  const pts = earnedPoints(criterion, result);
  const weight = criterion?.weight ?? 0;
  const mine = appeals.filter((a) => a.criterionId === result.criterionId);
  const pending = mine.some((a) => a.status === 'pending');
  const panelId = `crit-${evaluationId}-${result.criterionId}`;

  return (
    <li id={`row-${evaluationId}-${result.criterionId}`} className={cn('rounded-2xl transition-colors', open ? 'bg-fill ring-1 ring-brand/60' : 'hover:bg-fill/60')}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panelId} className="w-full rounded-2xl px-4 py-3 text-left">
        <span className="flex items-start justify-between gap-4">
          <span className="min-w-0">
            <span className="block text-base font-medium leading-6">
              <span className="mr-2 text-sm tabular-nums text-muted">{result.criterionId}</span>
              {criterion?.title ?? 'Критерий не найден в чек-листе'}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              {criterion?.criticalFlag ? 'флаг, без баллов' : result.isNA ? `вес ${weight}: не считается` : `вес ${weight}`}
              {needsReview(result) && <Badge tone="warn">Проверить</Badge>}
              {changed && <Badge tone="warn">Изменено ревьюером</Badge>}
              {pending && <Badge tone="warn">Апелляция</Badge>}
              {result.reusedFrom && <Badge>Из прошлой оценки</Badge>}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {changed && original && <span className="text-xs text-muted line-through" aria-label={`Ответ ИИ был: ${outcome(criterion, original).label}`}>ИИ: {outcome(criterion, original).label}</span>}
            <span className={cn('inline-flex h-8 items-center rounded-full px-3 text-sm font-semibold whitespace-nowrap', CHIP[o.tone])}>{o.label}</span>
            <ChevronDown aria-hidden className={cn('size-4 text-muted transition-transform', open && 'rotate-180')} />
          </span>
        </span>
        {pts !== null && weight > 0 && (
          <span className="mt-3 flex items-center gap-4">
            <span className="h-1 flex-1 rounded-full bg-line"><span className={cn('block h-1 rounded-full', BAR[o.tone])} style={{ width: `${Math.round((pts / weight) * 100)}%` }} /></span>
            <span className="min-w-16 text-right text-xs tabular-nums text-muted">{formatScore(pts)} / {weight}</span>
          </span>
        )}
      </button>

      {open && (
        <div id={panelId} className="space-y-4 px-4 pb-4">
          {result.isNA && result.naReason && <p className="text-sm"><span className="font-medium">Причина N/A:</span> {result.naReason}</p>}
          <p className="text-sm leading-5">{result.explanation}</p>

          {result.evidence.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Доказательства">
              {result.evidence.map((e, i) => (
                <EvidenceChip key={`${e.messageIndex}-${i}`} e={e} conversation={conversation} onJump={onJump} />
              ))}
            </div>
          )}
          {result.checkedRange && (
            <p className="text-xs text-muted">
              Проверены сообщения #{result.checkedRange.from}–#{result.checkedRange.to}
              {result.evidence.length === 0 ? ': подтверждающих реплик не найдено.' : '.'}
            </p>
          )}

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {result.source && <span>Решение: {SOURCE_LABEL[result.source].toLowerCase()}</span>}
            {result.confidence && <span className={cn(result.confidence === 'low' && 'font-medium text-warn')}>Уверенность: {CONFIDENCE_LABEL[result.confidence]}{result.confidence === 'low' ? ' · нужна проверка человеком' : ''}</span>}
          </p>

          <AppealBox evaluationId={evaluationId} criterionId={result.criterionId} criterion={criterion} appeals={appeals} onCreate={onCreateAppeal} onDecide={onDecideAppeal} />

          {criterion && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer select-none hover:text-ink">Как оценивается критерий</summary>
              <p className="mt-1 leading-relaxed">{criterion.instructions}</p>
            </details>
          )}
        </div>
      )}
    </li>
  );
}

export function EvaluationPanel({ conversation, evaluation, checklist, selectedCriterionId, onSelectCriterion, onJump, onStart, starting, startError, appeals, onCreateAppeal, onDecideAppeal, versions, onPickEvaluation, newerChecklistVersion }: Props) {
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const lookup = (id: string) => checklist?.criteria.find((c) => c.id === id);

  if (!evaluation) {
    return (
      <section aria-label="Оценка" className="flex h-full flex-col items-start gap-3 p-5">
        <h2 className="text-base font-semibold">Диалог ещё не оценён</h2>
        <p className="max-w-prose text-sm text-muted">Оценки нет, и мы не показываем выдуманных. Запустите оценку по текущему чек-листу.</p>
        <Button variant="accent" size="lg" onClick={onStart} disabled={starting || !checklist}>
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
        <Button variant="accent" size="lg" onClick={onStart} disabled={starting}>{starting ? 'Идёт оценка…' : 'Повторить оценку'}</Button>
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
  const reasons = violationReasons(evaluation, checklist);
  const lost = evaluation.finalResults
    .map((r) => ({ id: r.criterionId, loss: (lookup(r.criterionId)?.weight ?? 0) - (earnedPoints(lookup(r.criterionId), r) ?? (lookup(r.criterionId)?.weight ?? 0)) }))
    .filter((x) => x.loss > 0);
  const naIds = evaluation.finalResults.filter((r) => r.isNA && (lookup(r.criterionId)?.weight ?? 0) > 0).map((r) => r.criterionId);
  const pendingIds = new Set(appeals.filter((a) => a.status === 'pending').map((a) => a.criterionId));
  const flagged = (r: CriterionResult) => needsReview(r) || pendingIds.has(r.criterionId) || !sameResult(originalById.get(r.criterionId), r);
  const flaggedCount = evaluation.finalResults.filter(flagged).length;
  const shown = onlyFlagged ? evaluation.finalResults.filter(flagged) : evaluation.finalResults;
  const changedCount = evaluation.finalResults.filter((r) => !sameResult(originalById.get(r.criterionId), r)).length;

  const sections = checklist?.sections ?? [];
  const groups = sections.length
    ? [...sections.map((s) => ({ id: s.id, title: s.title, rows: shown.filter((r) => lookup(r.criterionId)?.sectionId === s.id) })), { id: '_', title: 'Прочее', rows: shown.filter((r) => !sections.some((s) => s.id === lookup(r.criterionId)?.sectionId)) }].filter((g) => g.rows.length)
    : [{ id: '_', title: '', rows: shown }];

  const scorecardRows = shown.map((r) => ({ r, c: lookup(r.criterionId) }));

  return (
    <section aria-label="Оценка" className="flex h-full min-h-0 flex-col">
      <header className="verdict px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h2 className="text-sm font-medium text-[#9fb5a9]">Оценка{versions.length <= 1 && checklist ? ` · чек-лист, версия ${checklist.version}` : ''}</h2>
          <div className="flex flex-wrap gap-2">
            {pendingIds.size > 0 && <span className="inline-flex h-6 items-center rounded-full bg-white/10 px-2 text-xs">Апелляция: {pendingIds.size}</span>}
            {changedCount > 0 && <span className="inline-flex h-6 items-center rounded-full bg-white/10 px-2 text-xs">Изменено ревьюером: {changedCount}</span>}
          </div>
        </div>
        {isMock && (
          <p className="mt-1 flex items-center gap-2 text-xs text-[#e8be6a]" role="note">
            <FlaskConical aria-hidden className="size-4 shrink-0" />
            Демо-данные: вымышленный пример, а не оценка модели.
          </p>
        )}
        <p className="mt-1 flex items-baseline gap-2">
          <span className="text-score font-semibold tracking-tight tabular-nums">{formatScore(evaluation.finalTotal)}</span>
          <span className="text-base text-[#9fb5a9]">из 100</span>
        </p>
        {evaluation.originalTotal !== evaluation.finalTotal && <p className="mt-1 text-xs text-[#9fb5a9]">Исходная оценка ИИ: {formatScore(evaluation.originalTotal)}</p>}
        <p className="mt-2 text-sm text-[#9fb5a9]">
          {evaluation.finalTotal === null
            ? 'Нет применимых критериев: балл не считается.'
            : lost.length
              ? `Потеряно: ${lost.map((x) => `${x.id} (−${formatScore(x.loss)})`).join(', ')}.`
              : 'Баллы не потеряны.'}
          {naIds.length > 0 && ` N/A: ${naIds.join(', ')}, вес перераспределён.`}
        </p>

        {evaluation.seriousViolation ? (
          <div className="mt-3 rounded-xl bg-[#3a1a16] p-4 text-[#ffd3cb]" role="alert">
            <p className="flex items-center gap-2 text-base font-semibold"><ShieldAlert aria-hidden className="size-4" />Грубое нарушение</p>
            {reasons.length === 0 && <p className="mt-1 text-sm">Флаг поднят.</p>}
            {reasons.map((r) => (
              <p key={r.criterionId} className="mt-1 text-sm leading-5"><span className="font-medium">{r.title}:</span> {r.explanation}</p>
            ))}
          </div>
        ) : (
          <p className="mt-3 inline-flex h-8 items-center gap-2 rounded-full bg-white/10 px-3 text-sm"><span aria-hidden className="size-2 rounded-full bg-brand" />Грубых нарушений нет</p>
        )}
      </header>

      {(versions.length > 1 || newerChecklistVersion !== null || startError) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-6 py-3">
          {versions.length > 1 && (
            <label className="flex items-center gap-2 text-xs">
              <span className="text-muted">Оценка по версии:</span>
              <Select aria-label="Оценка по версии чек-листа" value={evaluation.id} onChange={(e) => onPickEvaluation(e.target.value)} className="h-8 w-auto rounded-full text-xs">
                {versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </Select>
            </label>
          )}
          {newerChecklistVersion !== null && (
            <Button size="sm" onClick={onStart} disabled={starting}>{starting ? 'Идёт оценка…' : `Есть версия ${newerChecklistVersion}: пересчитать`}</Button>
          )}
          {startError && <span role="alert" className="text-xs text-danger">{startError}</span>}
        </div>
      )}

      <div className="border-b border-line bg-surface px-6 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted">Критерии: нажмите, чтобы открыть</p>
          {flaggedCount > 0 && (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} className="size-4 accent-brand" />
              Только требующие внимания ({flaggedCount})
            </label>
          )}
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-2">
          {scorecardRows.map(({ r, c }) => {
            const o = outcome(c, r);
            return (
              <button
                key={r.criterionId}
                type="button"
                onClick={() => {
                  onSelectCriterion(r.criterionId);
                  document.getElementById(`row-${evaluation.id}-${r.criterionId}`)?.scrollIntoView?.({ block: 'nearest' });
                }}
                aria-label={`Критерий ${r.criterionId}: ${o.label}`}
                aria-pressed={selectedCriterionId === r.criterionId}
                className={cn('flex h-12 flex-col items-center justify-center rounded-xl text-center transition-colors', CHIP[o.tone], selectedCriterionId === r.criterionId && 'ring-2 ring-ink')}
              >
                <span className="text-sm font-semibold leading-5 tabular-nums">{r.criterionId}</span>
                <span className="text-xs leading-4">{shortOutcome(c, r)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-surface p-2 pb-6">
        {groups.map((g) => (
          <div key={g.id}>
            {g.title && <h3 className="mb-1 mt-2 px-4 text-xs font-medium text-muted">{g.title}</h3>}
            <ul className="space-y-1">
              {g.rows.map((r) => (
                <CriterionRow
                  key={r.criterionId}
                  criterion={lookup(r.criterionId)}
                  result={r}
                  original={originalById.get(r.criterionId)}
                  conversation={conversation}
                  open={selectedCriterionId === r.criterionId}
                  onToggle={() => onSelectCriterion(r.criterionId)}
                  onJump={onJump}
                  evaluationId={evaluation.id}
                  appeals={appeals}
                  onCreateAppeal={onCreateAppeal}
                  onDecideAppeal={onDecideAppeal}
                />
              ))}
            </ul>
          </div>
        ))}
        {shown.length === 0 && <p className="p-4 text-sm text-muted">Ничего не требует внимания.</p>}
      </div>
    </section>
  );
}
