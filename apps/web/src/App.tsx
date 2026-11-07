import type { Appeal, ChecklistVersion, Conversation, DecideAppealInput, Evaluation, SaveChecklistInput } from '@cqa/contracts';
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, PanelLeft } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from './ApiContext';
import { cn } from '@/lib/utils';
import { DEFAULT_FILTERS, hasViolation, matches, needsAttention, reviewCount, type Filters } from '@/lib/queue';
import { formatScore, outcome, type Tone } from '@/lib/present';
import { useTheme } from '@/lib/theme';
import { ChecklistEditor } from './features/ChecklistEditor';
import { DialogsPage } from './features/DialogsPage';
import { LoadingShell } from './features/LoadingShell';
import { PrintReport } from './features/PrintReport';
import { QueueRail } from './features/QueueRail';
import { Sidebar } from './features/Sidebar';
import { EvaluationPanel } from './features/EvaluationPanel';
import { Transcript, type Focus, type Tag } from './features/Transcript';
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
  const [searchFocus, setSearchFocus] = useState(0);
  const [railOpen, setRailOpen] = useState(() => window.innerWidth >= 1440);

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

  /** Search lives at the top of the queue beside a dialog, and on the list page otherwise. */
  const focusSearch = useCallback(() => {
    const wide = window.matchMedia?.('(min-width: 1280px)').matches ?? window.innerWidth >= 1280;
    if (route.name === 'dialog' && wide) setRailOpen(true);
    else if (route.name !== 'list') {
      keepFocus.current = true;
      go({ name: 'list' });
    }
    setSearchFocus((n) => n + 1);
  }, [route.name, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'л')) {
        e.preventDefault();
        focusSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusSearch]);

  /** Page title per screen (tab, screen readers) and focus moved to the content after navigation, not on first load. */
  const routeKey = route.name === 'dialog' ? `dialog:${route.id}` : route.name;
  const firstRoute = useRef(true);
  const keepFocus = useRef(false); // set when navigation was started by the search shortcut, which focuses the search field itself
  useEffect(() => {
    document.title = route.name === 'dialog' ? `${route.id} · CQA` : route.name === 'checklist' ? 'Чек-лист · CQA' : 'Диалоги · CQA';
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    if (keepFocus.current) keepFocus.current = false;
    else document.getElementById('content')?.focus({ preventScroll: true });
  }, [routeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The next dialog after this one in the queue that needs a human look; wraps around. */
  const nextAttention = useMemo(() => {
    if (!selectedId || queue.length === 0) return null;
    const from = Math.max(queue.indexOf(selectedId), 0);
    for (let k = 1; k <= queue.length; k++) {
      const id = queue[(from + k) % queue.length]!;
      if (id !== selectedId && needsAttention(latest.get(id))) return id;
    }
    return null;
  }, [queue, selectedId, latest]);

  const evaluationId = (() => {
    const list = selectedId ? byConversation.get(selectedId) : undefined;
    return (list?.find((e) => e.id === pickedEvaluationId) ?? list?.[list.length - 1])?.id ?? null;
  })();

  /** Results the digit keys 1-9 open, in the order the panel lists them. */
  const shortcutResults = useMemo(() => {
    const list = selectedId ? byConversation.get(selectedId) : undefined;
    const ev = list?.find((e) => e.id === evaluationId);
    return ev?.status === 'completed' ? ev.finalResults : [];
  }, [byConversation, selectedId, evaluationId]);

  useEffect(() => {
    if (route.name !== 'dialog') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || (t instanceof Element && t.closest('input, textarea, select, [contenteditable]'))) return;
      if (e.key === 'j' || e.key === 'о') step(1);
      else if (e.key === 'k' || e.key === 'л') step(-1);
      else if ((e.key === 'n' || e.key === 'т') && nextAttention) go({ name: 'dialog', id: nextAttention });
      else if (/^[1-9]$/.test(e.key)) {
        const r = shortcutResults[Number(e.key) - 1];
        if (r) setCriterionId((cur) => (cur === r.criterionId ? null : r.criterionId));
      } else if (e.key === 'Escape') setCriterionId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route.name, step, nextAttention, go, shortcutResults]);

  useEffect(() => {
    if (!evaluationId) return setAppeals([]);
    let live = true;
    api.listAppeals({ evaluationId }).then((a) => live && setAppeals(a), () => live && setAppeals([]));
    return () => {
      live = false;
    };
  }, [api, evaluationId]);

  if (load.status === 'loading') return <LoadingShell />;
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

  /** Numbered tags on the messages each criterion cites, so the reason for a grade is visible in the text itself. */
  const tags = new Map<number, Tag[]>();
  if (evaluation?.status === 'completed') {
    for (const r of evaluation.finalResults) {
      const crit = checklist?.criteria.find((c) => c.id === r.criterionId);
      const o = outcome(crit, r);
      const tone: Tone = o.tone;
      for (const e of r.evidence) {
        if (!conversation?.transcript[e.messageIndex]) continue;
        const list = tags.get(e.messageIndex) ?? [];
        if (!list.some((t) => t.id === r.criterionId)) list.push({ id: r.criterionId, tone, title: crit?.title ?? r.criterionId, label: o.label, explanation: r.explanation });
        tags.set(e.messageIndex, list);
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
  const filterLabel = filters.quick === 'violations' ? 'Грубые нарушения' : filters.quick === 'review' ? 'Нужна проверка' : filters.quick === 'unevaluated' ? 'Не оценены' : null;
  const e = evaluation;

  /** Title and queue controls live at the top of the transcript card, so no separate bar takes vertical space. */
  const toolbar = conversation && (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <Button variant="ghost" size="sm" aria-label="К списку диалогов" onClick={() => go({ name: 'list' })} className="-ml-3"><ArrowLeft aria-hidden className="size-4" /></Button>
        <h1 className="text-2xl font-semibold leading-8">{conversation.id}</h1>
        {hasViolation(e) && <Badge tone="danger">Грубое нарушение</Badge>}
        {reviewCount(e) > 0 && <Badge tone="warn">Проверить: {reviewCount(e)}</Badge>}
        <p className="text-sm text-muted">{conversation.language} · {conversation.channel === 'voice call' ? 'звонок' : 'чат'} · {conversation.transcript.length} сообщений · индексы с нуля</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setRailOpen((o) => !o)} aria-pressed={railOpen} className="hidden xl:inline-flex"><PanelLeft aria-hidden className="size-4" />Очередь</Button>
        <Button variant="outline" size="sm" aria-label="Предыдущий диалог (K)" disabled={position <= 0} onClick={() => step(-1)}><ChevronLeft aria-hidden className="size-4" /></Button>
        <label className="sr-only" htmlFor="dialog-switch">Диалог</label>
        <Select id="dialog-switch" value={conversation.id} onChange={(ev) => go({ name: 'dialog', id: ev.target.value })} className="h-8 w-auto max-w-56 rounded-full text-sm font-medium xl:hidden">
          {position < 0 && <option value={conversation.id}>{conversation.id} (вне фильтра)</option>}
          {queue.map((id) => {
            const ev = latest.get(id);
            return <option key={id} value={id}>{id}{ev?.status === 'completed' ? ` · ${formatScore(ev.finalTotal)}` : ''}</option>;
          })}
        </Select>
        <Button variant="outline" size="sm" aria-label="Следующий диалог (J)" disabled={position < 0 || position >= queue.length - 1} onClick={() => step(1)}><ChevronRight aria-hidden className="size-4" /></Button>
        <p className="min-w-16 text-sm text-muted" aria-live="polite">{position >= 0 ? `${position + 1} из ${queue.length}` : 'вне фильтра'}</p>
        <Button variant="outline" size="sm" disabled={!nextAttention} onClick={() => nextAttention && go({ name: 'dialog', id: nextAttention })} title="Следующий диалог с нарушением, ошибкой оценки или низкой уверенностью (N)" aria-label="К диалогу, требующему проверки (N)">
          <AlertTriangle aria-hidden className="size-4" />
          <span className="hidden 2xl:inline">На проверку</span>
        </Button>
      </div>
    </div>
  );

  return (
    <>
    <div className="flex h-full flex-col md:flex-row print:hidden">
      <a href="#content" onClick={(e) => { e.preventDefault(); document.getElementById('content')?.focus(); }} className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:text-canvas">Перейти к содержимому</a>
      <Sidebar
        active={route.name === 'checklist' ? 'checklist' : 'dialogs'}
        onNavigate={(to) => go(to === 'checklist' ? { name: 'checklist' } : { name: 'list' })}
        theme={theme}
        onToggleTheme={toggleTheme}
        demo={mode === 'mock'}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {route.name === 'checklist' ? (
          <main id="content" tabIndex={-1} className="min-h-0 flex-1 bg-canvas outline-none">
            <ChecklistEditor checklists={data.checklists} conversationCount={data.conversations.length} onSave={saveChecklist} onEvaluate={evaluateWith} hasCurrentConversation={!!lastDialogId} />
          </main>
        ) : route.name === 'list' ? (
          <main id="content" tabIndex={-1} className="min-h-0 flex-1 bg-canvas outline-none">
            <DialogsPage conversations={data.conversations} latest={latest} checklists={data.checklists} filters={filters} onFilters={setFilters} onOpen={(id) => go({ name: 'dialog', id })} demo={mode === 'mock'} focusSignal={searchFocus} />
          </main>
        ) : !conversation ? (
          <main id="content" tabIndex={-1} className="p-6 text-sm outline-none">
            <p className="text-muted">Диалог «{selectedId}» не найден.</p>
            <Button className="mt-4" onClick={() => go({ name: 'list' })}>К списку диалогов</Button>
          </main>
        ) : (
          <>
            <nav aria-label="Разделы экрана" className="flex gap-1 border-b border-line bg-surface p-2 xl:hidden">
              {([['evaluation', 'Оценка'], ['transcript', 'Транскрипт']] as const).map(([id, label]) => (
                <button key={id} type="button" aria-pressed={pane === id} onClick={() => setPane(id)} className={cn('h-10 flex-1 rounded-full text-sm font-medium', pane === id ? 'bg-ink text-canvas' : 'text-muted')}>
                  {label}
                </button>
              ))}
            </nav>

            <main id="content" tabIndex={-1} className={cn('grid min-h-0 flex-1 gap-4 bg-canvas p-0 outline-none xl:p-4', railOpen ? 'xl:grid-cols-[280px_minmax(0,1fr)_480px]' : 'xl:grid-cols-[minmax(0,1fr)_480px]')}>
              {railOpen && (
                <div className="hidden min-h-0 overflow-hidden rounded-card bg-surface shadow-card xl:block">
                  <QueueRail conversations={data.conversations} latest={latest} ids={queue} selectedId={conversation.id} filterLabel={filterLabel} query={filters.query} onQuery={(q) => setFilters((f) => ({ ...f, query: q }))} focusSignal={searchFocus} onSelect={(id) => go({ name: 'dialog', id })} />
                </div>
              )}
              <div className={cn('min-h-0 flex-col bg-surface xl:rounded-card xl:shadow-card', pane === 'transcript' ? 'flex' : 'hidden xl:flex')}>
                <Transcript conversation={conversation} cited={cited} checkedRange={selectedResult?.evidence.length === 0 ? selectedResult.checkedRange : undefined} focus={focus} markers={markers} tags={tags} onTag={(id) => { setCriterionId(id); setPane('evaluation'); }} onSeek={jump} toolbar={toolbar} />
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
                  versions={list.map((ev, i) => ({ id: ev.id, label: `Версия ${versionOf(ev) ?? '?'}${i === list.length - 1 ? ' (последняя)' : ''}` }))}
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
    </div>
    {route.name === 'dialog' && conversation && evaluation?.status === 'completed' && <PrintReport conversation={conversation} evaluation={evaluation} checklist={checklist} />}
    </>
  );
}
