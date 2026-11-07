import { can, type Actor } from '@cqa/contracts';
import type { Appeal, ChecklistVersion, Conversation, Criterion, CriterionResult, DecideAppealInput, EvidenceReference, Evaluation } from '@cqa/contracts';
import { AlertTriangle, ChevronDown, Download, FlaskConical, Headphones, Link2Off, Loader2, Play, Printer, Quote, ShieldAlert, Square } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { ErrorNote } from '@/components/ui/error-note';
import { cn } from '@/lib/utils';
import { CONFIDENCE_LABEL, SOURCE_LABEL, criterionGroups, earnedPoints, formatScore, grade, isFlagged, needsReview, sameResult } from '@/lib/present';
import { downloadText, evaluationCsv } from '@/lib/export';
import { violationReasons } from '@/lib/queue';
import { fragmentLabel, segmentOf, usePlayer } from '@/lib/player';
import { useCountUp } from '@/lib/motion';
import { Meter } from '@/components/ui/meter';
import { ReviewBox, type Correction } from './Appeals';

type Props = {
  conversation: Conversation;
  evaluation: Evaluation | undefined;
  checklist: ChecklistVersion | undefined;
  selectedCriterionId: string | null;
  onSelectCriterion: (id: string) => void;
  onJump: (index: number) => void;
  /** Who is acting: decides which review actions a criterion offers. */
  identity: Actor;
  onStart: () => void;
  starting: boolean;
  /** A failed start of an evaluation (any thrown value; shown in Russian). */
  startError: unknown;
  /** Appeals of this evaluation, and the handlers that file/decide them. */
  appeals: Appeal[];
  onCreateAppeal: (criterionId: string, comment: string) => Promise<void>;
  onDecideAppeal: (input: DecideAppealInput) => Promise<void>;
  /** A reviewer's direct correction of one criterion. */
  onCorrect: (criterionId: string, c: Correction) => Promise<void>;
  /** "Требуют внимания" filter: owned by the app because the digit shortcuts follow the rows shown. */
  onlyFlagged: boolean;
  onOnlyFlagged: (v: boolean) => void;
  /** The whole app runs on fictional data and says so in the sidebar; the panel then does not repeat it. */
  demoMode: boolean;
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
  const player = usePlayer();
  const seg = player.available ? segmentOf(conversation, e.messageIndex) : null;
  const playing = player.playing === e.messageIndex;
  const jump = (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onJump(e.messageIndex);
      }}
      className={cn('inline-flex min-h-10 min-w-0 max-w-full items-center gap-2 px-3 text-left text-sm transition-colors hover:bg-brand-soft', seg ? 'rounded-l-full' : 'rounded-full border border-line-strong bg-surface hover:border-accent')}
      aria-label={`Перейти к сообщению ${e.messageIndex}${e.quote ? `: ${e.quote}` : ''}`}
    >
      <Quote aria-hidden className="size-4 shrink-0 text-accent" />
      <span className="shrink-0 font-semibold tabular-nums">#{e.messageIndex}</span>
      {e.quote && <span className="truncate text-muted">«{e.quote}»</span>}
    </button>
  );
  if (!seg) return jump;
  /** On a call the chip has two halves: go to the message, and hear exactly that moment. */
  return (
    <span className="inline-flex max-w-full items-stretch rounded-full border border-line-strong bg-surface">
      {jump}
      <button
        type="button"
        onClick={(ev) => {
          ev.stopPropagation();
          if (playing) player.stop();
          else player.playFragments([e.messageIndex]);
        }}
        aria-label={playing ? 'Остановить фрагмент' : `Прослушать фрагмент ${fragmentLabel(conversation, seg)}`}
        title={playing ? 'Остановить' : `Прослушать ${fragmentLabel(conversation, seg)}`}
        className={cn('inline-flex min-h-10 shrink-0 items-center gap-1 rounded-r-full border-l border-line-strong px-3 text-xs tabular-nums transition-colors', playing ? 'bg-brand text-[#0e151c]' : 'text-muted hover:bg-brand-soft hover:text-ink')}
      >
        {playing ? <Square aria-hidden className="size-3 fill-current" /> : <Play aria-hidden className="size-4" />}
        {fragmentLabel(conversation, seg)}
      </button>
    </span>
  );
}

/** Plays every cited moment of a criterion in order: the way to check "what happened" on a call by ear. */
function ListenAll({ result, conversation }: { result: CriterionResult; conversation: Conversation }) {
  const player = usePlayer();
  if (!player.available) return null;
  const segs = [...new Set(result.evidence.map((e) => e.messageIndex))].map((i) => segmentOf(conversation, i)).filter((sg) => sg !== null);
  const distinct = segs.filter((sg, k) => segs.findIndex((o) => o.from === sg.from && o.to === sg.to) === k);
  const indices = segs.map((sg) => sg.index);
  if (distinct.length < 2) return null;
  const active = player.playing !== null && indices.includes(player.playing);
  return (
    <Button size="sm" variant={active ? 'primary' : 'outline'} onClick={() => (active ? player.stop() : player.playFragments(indices))}>
      {active ? <Square aria-hidden className="size-3 fill-current" /> : <Headphones aria-hidden className="size-4" />}
      {active ? 'Остановить' : `Прослушать фрагменты (${distinct.length})`}
    </Button>
  );
}

/** The total as an arc in the banner (decorative: the number beside it is the fact). Uses the banner's focus color, light green or light red. */
function ScoreRing({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value)) / 100;
  return (
    <svg aria-hidden viewBox="0 0 64 64" className="size-12 shrink-0 -rotate-90 md:size-16">
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-white/15" />
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" strokeLinecap="round" stroke="var(--c-focus)" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
    </svg>
  );
}

/** Full marks are quiet (text only); a fill means something to look at: points lost (amber), nothing earned or a violation (red). */
const CHIP = { neutral: 'text-muted', success: 'text-accent', danger: 'bg-danger-soft text-danger', warn: 'bg-warn-soft text-warn' } as const;

/** Data written before the reviewer's reason became the explanation carried an English prefix. */
const reviewerText = (r: CriterionResult) => r.explanation.replace(/^Reviewer override: /, '');

/** Explanation, evidence and how it was decided, for one result (the AI's, or the current one). */
function Reasoning({ result, conversation, onJump, title }: { result: CriterionResult; conversation: Conversation; onJump: (i: number) => void; title?: ReactNode }) {
  return (
    <div className="space-y-3">
      {title}
      {result.isNA && result.naReason && result.source !== 'reviewer' && <p className="text-sm"><span className="font-medium">Причина N/A:</span> {result.naReason}</p>}
      <p className="max-w-[65ch] text-base leading-6">{result.explanation}</p>
      {result.evidence.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Доказательства">
          {result.evidence.map((e, i) => (
            <EvidenceChip key={`${e.messageIndex}-${i}`} e={e} conversation={conversation} onJump={onJump} />
          ))}
          <ListenAll result={result} conversation={conversation} />
        </div>
      )}
      {result.checkedRange && (
        <p className="text-xs text-muted">
          Проверены сообщения #{result.checkedRange.from}–#{result.checkedRange.to}
          {result.evidence.length === 0 ? ': подтверждающих реплик не найдено.' : '.'}
        </p>
      )}
      {(result.source || result.confidence) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {result.source && <span>Решение: {SOURCE_LABEL[result.source].toLowerCase()}</span>}
          {result.confidence && <span className={cn(result.confidence === 'low' && 'font-medium text-warn')}>Уверенность: {CONFIDENCE_LABEL[result.confidence]}{result.confidence === 'low' ? ' · нужна проверка человеком' : ''}</span>}
        </p>
      )}
    </div>
  );
}

type RowProps = { identity: Actor; criterion: Criterion | undefined; result: CriterionResult; original: CriterionResult | undefined; conversation: Conversation; open: boolean; onToggle: () => void; onJump: (i: number) => void; evaluation: Evaluation; checklist: ChecklistVersion | undefined; appeals: Appeal[]; onCreateAppeal: Props['onCreateAppeal']; onDecideAppeal: Props['onDecideAppeal']; onCorrect: Props['onCorrect'] };

function CriterionRow({ identity, criterion, result, original, conversation, open, onToggle, onJump, evaluation, checklist, appeals, onCreateAppeal, onDecideAppeal, onCorrect }: RowProps) {
  const g = grade(criterion, result);
  const changed = !!original && !sameResult(original, result);
  const pts = earnedPoints(criterion, result);
  const weight = criterion?.weight ?? 0;
  const pending = appeals.some((a) => a.criterionId === result.criterionId && a.status === 'pending');
  const panelId = `crit-${evaluation.id}-${result.criterionId}`;
  const ai = changed && original ? original : null;
  /** Something the reviewer came for: lost points, low confidence, an appeal or a change. (A raised flag's reason is in the banner already.) */
  const problem = (pts !== null && pts < weight) || needsReview(result) || pending || changed;

  return (
    <li id={`row-${evaluation.id}-${result.criterionId}`} className={cn('scroll-mt-2 rounded-xl transition-colors', open ? 'bg-fill ring-1 ring-brand/60' : 'hover:bg-fill/60')}>
      {/*
        Hierarchy inside the list: a row with full marks is one quiet line; a row that lost points, raised a flag or needs a
        human shows why (first lines of the explanation) without being opened, because that is what a reviewer came for.
        Rows are compact on short screens and get more air from 50rem of viewport height.
      */}
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panelId} className="w-full rounded-xl px-4 py-1 text-left [@media(min-height:50rem)]:py-2">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-base font-medium leading-6">
              <span className="mr-2 text-sm tabular-nums text-muted">{result.criterionId}</span>
              {criterion?.title ?? 'Критерий не найден в чек-листе'}
            </span>
            {problem && !open && <span className="mt-1 line-clamp-2 max-w-[65ch] text-sm leading-5 text-muted">{changed ? reviewerText(result) : result.explanation}</span>}
            {(needsReview(result) || pending || changed || result.reusedFrom) && (
              <span className="mt-1 flex flex-wrap items-center gap-2">
                {needsReview(result) && <Badge tone="warn">Проверить</Badge>}
                {pending && <Badge tone="warn">Апелляция</Badge>}
                {changed && <Badge>Изменено проверяющим</Badge>}
                {result.reusedFrom && <Badge>Из прошлой оценки</Badge>}
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {ai && <span className="text-xs tabular-nums text-muted line-through" aria-label={`Ответ ИИ был: ${grade(criterion, ai).label}`}>ИИ: {grade(criterion, ai).label}</span>}
            <span className={cn('relative inline-flex h-6 items-center rounded-full px-2 text-sm font-semibold tabular-nums whitespace-nowrap', CHIP[g.tone])} title={result.isNA ? `Не применим: вес ${weight} не учитывается` : undefined}>
              {g.label}
              {/* Lost points drawn as a share of the weight, under the chip so the row stays one line. Full marks stay quiet; N/A, flags and a changed grade (neutral by design) get none. */}
              {pts !== null && pts < weight && !changed && <Meter value={pts} max={weight} tone={pts === 0 ? 'danger' : 'warn'} className="absolute inset-x-2 -bottom-1" />}
            </span>
            <ChevronDown aria-hidden className={cn('size-4 text-muted transition-transform', open && 'rotate-180')} />
          </span>
        </span>
      </button>

      {open && (
        <div id={panelId} className="reveal space-y-4 px-4 pb-4 pt-1">
          {(result.isNA || (pts !== null && pts < weight)) && (
            <p className="text-xs text-muted">{result.isNA ? `Не применим: вес ${weight} не входит в итог.` : `Потеряно ${formatScore(weight - (pts ?? 0))} из ${weight} баллов.`}</p>
          )}
          {ai ? (
            <>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted">Проверяющий: {g.label}</p>
                <p className="max-w-[65ch] text-base leading-6">{reviewerText(result)}</p>
              </div>
              <div className="border-t border-line pt-3">
                <Reasoning result={ai} conversation={conversation} onJump={onJump} title={<p className="text-xs font-medium text-muted">Исходный ответ ИИ: {grade(criterion, ai).label}</p>} />
              </div>
            </>
          ) : (
            <Reasoning result={result.source === 'reviewer' ? { ...result, explanation: reviewerText(result) } : result} conversation={conversation} onJump={onJump} />
          )}

          {criterion && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer select-none hover:text-ink">Как оценивается критерий</summary>
              <p className="mt-1 max-w-[65ch] leading-5">{criterion.instructions}</p>
            </details>
          )}

          <ReviewBox identity={identity} evaluation={evaluation} checklist={checklist} criterionId={result.criterionId} criterion={criterion} appeals={appeals} onCreate={onCreateAppeal} onDecide={onDecideAppeal} onCorrect={onCorrect} />
        </div>
      )}
    </li>
  );
}

export function EvaluationPanel({ identity, conversation, evaluation, checklist, selectedCriterionId, onSelectCriterion, onJump, onStart, starting, startError, appeals, onCreateAppeal, onDecideAppeal, onCorrect, onlyFlagged, onOnlyFlagged, demoMode, versions, onPickEvaluation, newerChecklistVersion }: Props) {
  /** An opened criterion (digit key, tag on a message, link) is brought into view with its form. */
  useEffect(() => {
    if (!selectedCriterionId || !evaluation) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(`row-${evaluation.id}-${selectedCriterionId}`)?.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [selectedCriterionId, evaluation?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const lookup = (id: string) => checklist?.criteria.find((c) => c.id === id);
  // Hooks run before the early returns below; counts once per dialog, not per evaluation version.
  const shownTotal = useCountUp(evaluation?.status === 'completed' ? evaluation.finalTotal : null, conversation.id);

  if (!evaluation) {
    return (
      <section aria-label="Оценка" className="flex h-full flex-col items-start gap-3 p-5">
        <h2 className="text-base font-semibold">Диалог ещё не оценён</h2>
        <p className="max-w-prose text-sm text-muted">Оценки нет, и мы не показываем выдуманных. Запустите оценку по текущему чек-листу.</p>
        {can(identity, 'evaluate') && (
          <Button variant="accent" size="lg" onClick={onStart} disabled={starting || !checklist}>
            {starting && <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />}
            {starting ? 'Идёт оценка…' : 'Оценить диалог'}
          </Button>
        )}
        <ErrorNote error={startError} />
      </section>
    );
  }

  if (evaluation.status === 'failed') {
    return (
      <section aria-label="Оценка" className="flex h-full flex-col items-start gap-3 p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-danger"><AlertTriangle aria-hidden className="size-5" />Оценка не получилась</h2>
        <ErrorNote error={evaluation.error ?? 'Причина не указана.'} className="max-w-prose text-ink" />
        {can(identity, 'evaluate') && <Button variant="accent" size="lg" onClick={onStart} disabled={starting}>{starting ? 'Идёт оценка…' : 'Повторить оценку'}</Button>}
        <ErrorNote error={startError} />
      </section>
    );
  }

  if (evaluation.status !== 'completed') {
    return (
      <section aria-label="Оценка" className="flex h-full items-center gap-2 p-5 text-sm text-muted" role="status">
        <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />Оценка выполняется…
      </section>
    );
  }

  const isMock = evaluation.provenance?.provider === 'mock';
  const originalById = new Map(evaluation.originalResults.map((r) => [r.criterionId, r]));
  const reasons = violationReasons(evaluation, checklist);
  /** Points earned out of the points that were possible: N/A criteria and flags are not part of either number. */
  const scored = evaluation.finalResults.map((r) => ({ id: r.criterionId, c: lookup(r.criterionId), pts: earnedPoints(lookup(r.criterionId), r) })).filter((x) => x.pts !== null && x.c);
  const earned = scored.reduce((sum, x) => sum + (x.pts ?? 0), 0);
  const possible = scored.reduce((sum, x) => sum + (x.c?.weight ?? 0), 0);
  const naIds = evaluation.finalResults.filter((r) => r.isNA && (lookup(r.criterionId)?.weight ?? 0) > 0).map((r) => r.criterionId);
  const pendingIds = new Set(appeals.filter((a) => a.status === 'pending').map((a) => a.criterionId));
  const flaggedCount = evaluation.finalResults.filter((r) => isFlagged(r, originalById.get(r.criterionId), pendingIds)).length;
  const changedCount = evaluation.finalResults.filter((r) => !sameResult(originalById.get(r.criterionId), r)).length;
  const groups = criterionGroups(evaluation, checklist, appeals, onlyFlagged);

  return (
    <section aria-label="Оценка" className="flex h-full min-h-0 flex-col overflow-y-auto md:overflow-hidden">
      {/*
        Banner hierarchy: is the dialog OK, the large score and the violation status on one line; then state chips only
        when there are any. Where points went is the list below (colored rows with reasons), so it is not repeated here;
        how the total is made is the score's tooltip. The checklist version is the bar under the banner.
      */}
      <header className={cn('verdict shrink-0 px-4 py-4 sm:px-6', evaluation.seriousViolation && 'verdict-danger')}>
        <h2 className="sr-only">Оценка диалога</h2>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          {/* How the total is made lives in a tooltip: the rows below already show every lost point and every N/A. */}
          <p className="flex items-center gap-4" title={evaluation.finalTotal === null ? undefined : `Набрано ${formatScore(earned)} из ${formatScore(possible)} применимых баллов${naIds.length ? `; не применимы: ${naIds.join(', ')}` : ''}. Итог пересчитан на 100.`}>
            {shownTotal !== null && <ScoreRing value={shownTotal} />}
            <span className="flex items-baseline gap-2">
              {/* The number counts up once per dialog; while it runs, assistive tech gets the final value and the count is a hidden copy. */}
              {shownTotal !== evaluation.finalTotal && <span className="sr-only">{formatScore(evaluation.finalTotal)}</span>}
              <span aria-hidden={shownTotal !== evaluation.finalTotal || undefined} className="text-score-sm font-semibold tracking-tight tabular-nums md:text-score">{formatScore(shownTotal === null ? null : Math.round(shownTotal * 100) / 100)}</span>
              <span className="text-base text-verdict-muted">из 100</span>
            </span>
          </p>
          <p className="flex items-center gap-2 text-base font-medium">
            {evaluation.seriousViolation ? <><ShieldAlert aria-hidden className="size-4" />Грубое нарушение</> : <><span aria-hidden className="size-2 rounded-full bg-brand" />Грубых нарушений нет</>}
          </p>
        </div>
        {evaluation.finalTotal === null && <p className="mt-1 text-sm text-verdict-muted">Нет применимых критериев: балл не считается.</p>}
        {(evaluation.originalTotal !== evaluation.finalTotal || pendingIds.size > 0 || changedCount > 0 || (isMock && !demoMode)) && (
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-verdict-muted">
            {evaluation.originalTotal !== evaluation.finalTotal && <span>Исходная оценка ИИ: {formatScore(evaluation.originalTotal)}</span>}
            {pendingIds.size > 0 && <span className="inline-flex h-6 items-center rounded-full bg-white/10 px-2 text-white">Апелляция: {pendingIds.size}</span>}
            {changedCount > 0 && <span className="inline-flex h-6 items-center rounded-full bg-white/10 px-2 text-white">Изменено проверяющим: {changedCount}</span>}
            {isMock && !demoMode && <span title="Вымышленный пример, а не оценка модели" aria-label="Демо-данные: вымышленный пример, а не оценка модели" className="inline-flex h-6 items-center gap-1 rounded-full bg-verdict-warn-bg px-2 text-verdict-warn"><FlaskConical aria-hidden className="size-4" />Демо-данные</span>}
          </p>
        )}

        {evaluation.seriousViolation && (
          <div className="mt-3 space-y-1 border-t border-white/15 pt-3" role="alert">
            <span className="sr-only">Грубое нарушение: </span>
            {reasons.length === 0 && <p className="text-sm">Флаг поднят.</p>}
            {reasons.map((r) => (
              <p key={r.criterionId} className="text-sm leading-5 text-white">{reasons.length > 1 && <span className="font-medium">{r.title}: </span>}{r.explanation}</p>
            ))}
          </div>
        )}
      </header>

      {/*
        One fixed place for "which checklist graded this": always this slim bar, never the footer. Text for a single
        evaluation, a picker when the dialog was evaluated under several versions; recalculation on the right.
      */}
      <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-line bg-surface px-4 py-2 text-xs">
        {versions.length > 1 ? (
          <Select aria-label="Оценка по версии чек-листа" value={evaluation.id} onChange={(e) => onPickEvaluation(e.target.value)} className="h-8 w-auto rounded-full border-transparent bg-fill pl-3 pr-8 text-xs">
            {versions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </Select>
        ) : (
          <span className="text-muted">{checklist ? `Чек-лист, версия ${checklist.version}` : 'Чек-лист не найден'}</span>
        )}
        {newerChecklistVersion !== null && can(identity, 'evaluate') && (
          <Button size="sm" variant="ghost" className="px-2 text-xs" onClick={onStart} disabled={starting}>{starting ? 'Идёт оценка…' : `Пересчитать по версии ${newerChecklistVersion}`}</Button>
        )}
        {!!startError && <ErrorNote error={startError} className="w-full text-xs" />}
      </div>

      <div className="flex-1 space-y-2 bg-surface p-2 md:min-h-0 md:overflow-y-auto">
        {groups.map((g) => (
          <div key={g.id}>
            {g.title && <h3 className="px-4 pb-1 pt-2 text-xs font-medium text-muted">{g.title}</h3>}
            <ul className="space-y-1">
              {g.rows.map((r) => (
                <CriterionRow
                  key={r.criterionId}
                  identity={identity}
                  criterion={lookup(r.criterionId)}
                  result={r}
                  original={originalById.get(r.criterionId)}
                  conversation={conversation}
                  open={selectedCriterionId === r.criterionId}
                  onToggle={() => onSelectCriterion(r.criterionId)}
                  onJump={onJump}
                  evaluation={evaluation}
                  checklist={checklist}
                  appeals={appeals}
                  onCreateAppeal={onCreateAppeal}
                  onDecideAppeal={onDecideAppeal}
                  onCorrect={onCorrect}
                />
              ))}
            </ul>
          </div>
        ))}
        {groups.length === 0 && <p className="p-4 text-sm text-muted">Ничего не требует внимания.</p>}
      </div>

      <footer className="flex shrink-0 items-center gap-2 whitespace-nowrap border-t border-line bg-surface px-4 py-2 text-sm text-muted sm:px-6">
        {flaggedCount > 0 && (
          <label className="flex min-h-8 items-center gap-2 text-xs text-ink">
            <input type="checkbox" checked={onlyFlagged} onChange={(e) => onOnlyFlagged(e.target.checked)} className="size-4 accent-brand" />
            Требуют внимания ({flaggedCount})
          </label>
        )}
        <span className="ml-auto" />
        <button type="button" onClick={() => downloadText(`${conversation.id}-evaluation.csv`, evaluationCsv(conversation, evaluation, checklist), 'text/csv;charset=utf-8')} aria-label="Скачать оценку в CSV" title="Таблица для Excel" className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-ink hover:bg-fill"><Download aria-hidden className="size-4" />CSV</button>
        <button type="button" onClick={() => window.print()} aria-label="Печать или сохранить в PDF" title="Отчёт для печати или сохранения в PDF" className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-ink hover:bg-fill"><Printer aria-hidden className="size-4" />PDF</button>
      </footer>
    </section>
  );
}
