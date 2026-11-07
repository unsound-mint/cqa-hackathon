import type { Appeal, ChecklistVersion, Conversation, DecideAppealInput, Evaluation, SaveChecklistInput } from '@cqa/contracts';
import { ArrowLeft, ChevronLeft, ChevronRight, Moon, Sun } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from './ApiContext';
import { cn } from '@/lib/utils';
import { DEFAULT_FILTERS, hasViolation, matches, reviewCount, type Filters } from '@/lib/queue';
import { formatScore } from '@/lib/present';
import { useTheme } from '@/lib/theme';
import { ChecklistEditor } from './features/ChecklistEditor';
import { DialogsPage } from './features/DialogsPage';
import { EvaluationPanel } from './features/EvaluationPanel';
import { Transcript, type Focus } from './features/Transcript';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';

type Data = { conversations: Conversation[]; evaluations: Evaluation[]; checklists: ChecklistVersion[] };
type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: Data };
type Pane = 'transcript' | 'evaluation';
type Route = { name: 'list' } | { name: 'checklist' } | { name: 'dialog'; id: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function parseHash(): Route {
  const h = window.location.hash;
  if (h === '#/checklist') return { name: 'checklist' };
  const m = /^#\/dialog\/(.+)$/.exec(h);
  if (m) {
    try {
      return { name: 'dialog', id: decodeURIComponent(m[1]!) };
    } catch {
      return { name: 'list' };
    }
  }
  return { name: 'list' };
}
const hashFor = (r: Route) => (r.name === 'checklist' ? '#/checklist' : r.name === 'dialog' ? `#/dialog/${encodeURIComponent(r.id)}` : '#/');

export function App() {
  const api = useApi();
  const [theme, toggleTheme] = useTheme();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [route, setRoute] = useState<Route>(parseHash);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [lastDialogId, setLastDialogId] = useState<string | null>(null);
  const [pickedEvaluationId, setPickedEvaluationId] = useState<string | null>(null);
  const [criterionId, setCriterionId] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [pane, setPane] = useState<Pane>('evaluation');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [appeals, setAppeals] = useState<Appeal[]>([]);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((r: Route) => {
    window.location.hash = hashFor(r);
    setRoute(r);
  }, []);

  const selectedId = route.name === 'dialog' ? route.id : null;
  useEffect(() => {
    if (selectedId) {
      setLastDialogId(selectedId);
      setPickedEvaluationId(null);
      setCriterionId(null);
      setFocus(null);
      setStartError(null);
    }
  }, [selectedId]);

  const fetchAll = useCallback(async (): Promise<Data> => {
    const [conversations, evaluations, checklists] = await Promise.all([api.listConversations(), api.listEvaluations(), api.listChecklists()]);
    return { conversations, evaluations, checklists };
  }, [api]);
  const reload = useCallback(async () => setLoad({ status: 'ready', data: await fetchAll() }), [fetchAll]);

  useEffect(() => {
    let live = true;
    fetchAll().then(
      (data) => live && setLoad({ status: 'ready', data }),
      (e: unknown) => live && setLoad({ status: 'error', message: errorText(e) }),
    );
    return () => {
      live = false;
    };
  }, [fetchAll]);

  /** Evaluations per conversation, oldest first (the API lists them in creation order). */
  const byConversation = useMemo(() => {
    const m = new Map<string, Evaluation[]>();
    if (load.status === 'ready') for (const e of load.data.evaluations) (m.get(e.conversationId) ?? m.set(e.conversationId, []).get(e.conversationId)!).push(e);
    return m;
  }, [load]);
  const latest = useMemo(() => new Map([...byConversation].map(([id, list]) => [id, list[list.length - 1]!])), [byConversation]);

  /** The dialogs the list currently shows: previous/next and J/K walk this queue, not all dialogs. */
  const queue = useMemo(() => (load.status === 'ready' ? load.data.conversations.filter((c) => matches(c, latest.get(c.id), filters)).map((c) => c.id) : []), [load, latest, filters]);
  const position = selectedId ? queue.indexOf(selectedId) : -1;
  const step = useCallback(
    (by: 1 | -1) => {
      if (position < 0) return;
      const next = queue[position + by];
      if (next) go({ name: 'dialog', id: next });
    },
    [position, queue, go],
  );

  useEffect(() => {
    if (route.name !== 'dialog') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || (t instanceof Element && t.closest('input, textarea, select, [contenteditable]'))) return;
      if (e.key === 'j' || e.key === 'о') step(1);
      else if (e.key === 'k' || e.key === 'л') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route.name, step]);

  const evaluationId = (() => {
    const list = selectedId ? byConversation.get(selectedId) : undefined;
    return (list?.find((e) => e.id === pickedEvaluationId) ?? list?.[list.length - 1])?.id ?? null;
  })();

  useEffect(() => {
    if (!evaluationId) return setAppeals([]);
    let live = true;
    api.listAppeals({ evaluationId }).then((a) => live && setAppeals(a), () => live && setAppeals([]));
    return () => {
      live = false;
    };
  }, [api, evaluationId]);

  if (load.status === 'loading') return <p role="status" className="p-6 text-sm text-muted">Загрузка…</p>;
  if (load.status === 'error') {
    return (
      <div className="p-6">
        <p role="alert" className="text-sm text-danger">Не удалось загрузить данные: {load.message}</p>
        <Button className="mt-3" onClick={() => { setLoad({ status: 'loading' }); reload().catch((e: unknown) => setLoad({ status: 'error', message: errorText(e) })); }}>Повторить</Button>
      </div>
    );
  }

  const { data } = load;
  const conversation = data.conversations.find((c) => c.id === selectedId);
  const list = selectedId ? byConversation.get(selectedId) ?? [] : [];
  const evaluation = list.find((e) => e.id === evaluationId);
  const newestChecklist = [...data.checklists].sort((a, b) => b.version - a.version)[0];
  const checklist = data.checklists.find((c) => c.id === evaluation?.checklistVersionId) ?? newestChecklist;
  const selectedResult = evaluation?.finalResults.find((r) => r.criterionId === criterionId);
  const cited = new Set((selectedResult?.evidence ?? []).filter((e) => conversation?.transcript[e.messageIndex]).map((e) => e.messageIndex));
  const newer = evaluation && newestChecklist && checklist && newestChecklist.version > checklist.version ? newestChecklist.version : null;
  const versionOf = (e: Evaluation) => data.checklists.find((c) => c.id === e.checklistVersionId)?.version;

  /** Dots on the conversation map: a raised flag beats the selected criterion, which beats low confidence. */
  const markers = new Map<number, 'evidence' | 'review' | 'violation'>();
  if (evaluation?.status === 'completed') {
    const rank = { review: 1, evidence: 2, violation: 3 } as const;
    const put = (i: number, k: keyof typeof rank) => {
      if (conversation?.transcript[i] && (!markers.has(i) || rank[markers.get(i)!] < rank[k])) markers.set(i, k);
    };
    for (const r of evaluation.finalResults) {
      const isFlag = checklist?.criteria.find((c) => c.id === r.criterionId)?.criticalFlag && r.value === true;
      for (const e of r.evidence) {
        if (isFlag) put(e.messageIndex, 'violation');
        else if (r.criterionId === criterionId) put(e.messageIndex, 'evidence');
        else if (r.confidence === 'low') put(e.messageIndex, 'review');
      }
    }
  }

  /** Starts a job and waits for it; the job decides what is recomputed (rules and unchanged criteria are reused server-side). */
  const runJob = async (ids: string[], checklistVersionId: string) => {
    const { jobId } = await api.startEvaluation({ conversationIds: ids, checklistVersionId });
    for (;;) {
      const job = await api.getJob(jobId);
      if (job.status === 'completed' || job.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    await reload();
    setPickedEvaluationId(null);
  };

  const start = async () => {
    if (!selectedId || !newestChecklist) return;
    setStarting(true);
    setStartError(null);
    try {
      await runJob([selectedId], newestChecklist.id);
    } catch (e) {
      setStartError(errorText(e));
    } finally {
      setStarting(false);
    }
  };

  const saveChecklist = async (input: SaveChecklistInput) => {
    const v = await api.saveChecklistVersion(input);
    await reload();
    return v;
  };
  const evaluateWith = async (checklistVersionId: string, scope: 'current' | 'all') => {
    const ids = scope === 'all' ? data.conversations.map((c) => c.id) : lastDialogId ? [lastDialogId] : [];
    await runJob(ids, checklistVersionId);
  };

  const jump = (index: number) => {
    setPane('transcript');
    setFocus((f) => ({ index, nonce: (f?.nonce ?? 0) + 1 }));
  };

  const mode = import.meta.env.VITE_API_MODE ?? 'mock';
  const tab = (label: string, active: boolean, to: Route) => (
    <a href={hashFor(to)} onClick={(e) => { e.preventDefault(); go(to); }} aria-current={active ? 'page' : undefined} className={cn('flex min-h-11 items-center text-sm transition-colors', active ? 'font-medium text-ink shadow-[inset_0_-2px_0_var(--color-brand)]' : 'text-muted hover:text-ink')}>
      {label}
    </a>
  );
  const ThemeIcon = theme === 'dark' ? Sun : Moon;

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-line bg-surface px-4 sm:px-6">
        <div className="flex items-center gap-7">
          <div className="flex items-center gap-2"><span className="text-base font-semibold tracking-wide">CQA</span><span aria-hidden className="size-1.5 rounded-full bg-brand" /></div>
          <nav aria-label="Разделы" className="flex gap-5">
            {tab('Диалоги', route.name !== 'checklist', { name: 'list' })}
            {tab('Чек-лист', route.name === 'checklist', { name: 'checklist' })}
          </nav>
        </div>
        <div className="flex items-center gap-3 py-1">
          {mode === 'mock' && <Badge tone="warn" className="hidden sm:inline-flex">Демо: вымышленные данные</Badge>}
          <button type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'} className="grid size-10 place-items-center rounded-full border border-line text-ink hover:bg-fill">
            <ThemeIcon aria-hidden className="size-4" />
          </button>
        </div>
      </header>

      {route.name === 'checklist' ? (
        <main className="min-h-0 flex-1 bg-canvas">
          <ChecklistEditor checklists={data.checklists} conversationCount={data.conversations.length} onSave={saveChecklist} onEvaluate={evaluateWith} hasCurrentConversation={!!lastDialogId} />
        </main>
      ) : route.name === 'list' ? (
        <main className="min-h-0 flex-1 bg-canvas">
          <DialogsPage conversations={data.conversations} latest={latest} checklists={data.checklists} filters={filters} onFilters={setFilters} onOpen={(id) => go({ name: 'dialog', id })} />
        </main>
      ) : !conversation ? (
        <main className="p-6 text-sm">
          <p className="text-muted">Диалог «{selectedId}» не найден.</p>
          <Button className="mt-3" onClick={() => go({ name: 'list' })}>К списку диалогов</Button>
        </main>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-canvas px-4 py-2 sm:px-6">
            <Button variant="ghost" size="sm" onClick={() => go({ name: 'list' })}><ArrowLeft aria-hidden className="size-4" />Диалоги</Button>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" aria-label="Предыдущий диалог (K)" disabled={position <= 0} onClick={() => step(-1)}><ChevronLeft aria-hidden className="size-4" /></Button>
              <label className="sr-only" htmlFor="dialog-switch">Диалог</label>
              <Select id="dialog-switch" value={conversation.id} onChange={(e) => go({ name: 'dialog', id: e.target.value })} className="h-8 w-auto max-w-60 rounded-full text-sm font-medium">
                {position < 0 && <option value={conversation.id}>{conversation.id} (вне фильтра)</option>}
                {queue.map((id) => {
                  const e = latest.get(id);
                  return <option key={id} value={id}>{id}{e?.status === 'completed' ? ` · ${formatScore(e.finalTotal)}` : ''}</option>;
                })}
              </Select>
              <Button variant="outline" size="sm" aria-label="Следующий диалог (J)" disabled={position < 0 || position >= queue.length - 1} onClick={() => step(1)}><ChevronRight aria-hidden className="size-4" /></Button>
            </div>
            <p className="text-sm text-muted" aria-live="polite">
              {position >= 0 ? `${position + 1} из ${queue.length}` : 'вне фильтра'}
              {filters.quick !== 'all' && ` · ${filters.quick === 'violations' ? 'грубые нарушения' : filters.quick === 'review' ? 'нужна проверка' : 'не оценены'}`}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {hasViolation(evaluation) && <Badge tone="danger">Грубое нарушение</Badge>}
              {reviewCount(evaluation) > 0 && <Badge tone="warn">Проверить: {reviewCount(evaluation)}</Badge>}
            </div>
            <p className="ml-auto hidden text-xs text-muted lg:block"><kbd className="rounded border border-line bg-surface px-1.5">J</kbd> следующий · <kbd className="rounded border border-line bg-surface px-1.5">K</kbd> предыдущий</p>
          </div>

          <nav aria-label="Разделы экрана" className="flex gap-1 border-b border-line bg-surface p-2 xl:hidden">
            {([['evaluation', 'Оценка'], ['transcript', 'Транскрипт']] as const).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={pane === id} onClick={() => setPane(id)} className={cn('h-9 flex-1 rounded-full text-sm font-medium', pane === id ? 'bg-ink text-canvas' : 'text-muted')}>
                {label}
              </button>
            ))}
          </nav>

          <main className="grid min-h-0 flex-1 gap-4 bg-canvas p-0 xl:grid-cols-[minmax(0,1fr)_480px] xl:p-4">
            <div className={cn('min-h-0 flex-col bg-surface xl:rounded-card xl:shadow-card', pane === 'transcript' ? 'flex' : 'hidden xl:flex')}>
              <Transcript conversation={conversation} cited={cited} checkedRange={selectedResult?.evidence.length === 0 ? selectedResult.checkedRange : undefined} focus={focus} markers={markers} onSeek={jump} />
            </div>
            <div className={cn('min-h-0 flex-col overflow-hidden bg-surface xl:rounded-card xl:shadow-card', pane === 'evaluation' ? 'flex' : 'hidden xl:flex')}>
              <EvaluationPanel
                conversation={conversation}
                evaluation={evaluation}
                checklist={checklist}
                selectedCriterionId={criterionId}
                onSelectCriterion={(id) => setCriterionId((cur) => (cur === id ? null : id))}
                onJump={jump}
                onStart={start}
                starting={starting}
                startError={startError}
                appeals={appeals}
                onCreateAppeal={async (cid, comment) => {
                  if (!evaluation) return;
                  const a = await api.createAppeal({ evaluationId: evaluation.id, criterionId: cid, comment });
                  setAppeals((cur) => [...cur, a]);
                }}
                onDecideAppeal={async (input: DecideAppealInput) => {
                  const a = await api.decideAppeal(input);
                  setAppeals((cur) => cur.map((x) => (x.id === a.id ? a : x)));
                  await reload(); // an override changes finalResults, the total and the violation flag
                }}
                versions={list.map((e, i) => ({ id: e.id, label: `Версия ${versionOf(e) ?? '?'}${i === list.length - 1 ? ' (последняя)' : ''}` }))}
                onPickEvaluation={(id) => {
                  setPickedEvaluationId(id);
                  setCriterionId(null);
                }}
                newerChecklistVersion={newer}
              />
            </div>
          </main>
        </>
      )}
    </div>
  );
}
