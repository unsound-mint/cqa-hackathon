import type { Appeal, ChecklistVersion, Conversation, DecideAppealInput, Evaluation, SaveChecklistInput } from '@cqa/contracts';
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, PanelLeftOpen } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MockCqaApi } from './api';
import { useApi } from './ApiContext';
import { cn } from '@/lib/utils';
import { DEFAULT_FILTERS, counts, matches, needsAttention, type Filters } from '@/lib/queue';
import { criterionGroups, formatScore, grade } from '@/lib/present';
import { useTwoPane, useWide } from '@/lib/media';
import { PlayerProvider } from '@/lib/player';
import { useTheme } from '@/lib/theme';
import { AppealsPage } from './features/AppealsPage';
import { ChecklistEditor } from './features/ChecklistEditor';
import { DialogsPage } from './features/DialogsPage';
import { LoadingShell } from './features/LoadingShell';
import { PrintReport } from './features/PrintReport';
import { QueueRail } from './features/QueueRail';
import { Sidebar } from './features/Sidebar';
import { EvaluationPanel } from './features/EvaluationPanel';
import type { Correction } from './features/Appeals';
import { Transcript, type Focus, type Tag } from './features/Transcript';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Splitter } from '@/components/ui/splitter';
import { humanError } from '@/lib/errors';

type Data = { conversations: Conversation[]; evaluations: Evaluation[]; checklists: ChecklistVersion[]; appeals: Appeal[] };
type Load = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; data: Data };
type Pane = 'transcript' | 'evaluation';
type Route = { name: 'list' } | { name: 'checklist' } | { name: 'appeals' } | { name: 'dialog'; id: string; criterion?: string };


function parseHash(): Route {
  const h = window.location.hash;
  if (h === '#/checklist') return { name: 'checklist' };
  if (h === '#/appeals') return { name: 'appeals' };
  const m = /^#\/dialog\/([^?]+)(?:\?criterion=(.+))?$/.exec(h);
  if (m) {
    try {
      return { name: 'dialog', id: decodeURIComponent(m[1]!), ...(m[2] ? { criterion: decodeURIComponent(m[2]) } : {}) };
    } catch {
      return { name: 'list' };
    }
  }
  return { name: 'list' };
}
const hashFor = (r: Route) => (r.name === 'checklist' ? '#/checklist' : r.name === 'appeals' ? '#/appeals' : r.name === 'dialog' ? `#/dialog/${encodeURIComponent(r.id)}${r.criterion ? `?criterion=${encodeURIComponent(r.criterion)}` : ''}` : '#/');

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
  const [startError, setStartError] = useState<unknown>(null);
  const [searchFocus, setSearchFocus] = useState(0);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const fits = useWide();
  /** The queue rail is optional: a reviewer can collapse it (remembered per browser; storage may be unavailable). */
  const [railHidden, setRailHidden] = useState(() => {
    try {
      return window.localStorage.getItem('cqa-queue-hidden') === '1';
    } catch {
      return false;
    }
  });
  const hideRail = (v: boolean) => {
    setRailHidden(v);
    try {
      window.localStorage.setItem('cqa-queue-hidden', v ? '1' : '0');
    } catch {
      /* per-browser convenience only */
    }
  };
  /**
   * Pane widths the reviewer dragged (px), remembered per browser. Null = the default (rail 17.5rem, verdict fluid).
   * The transcript, the main reading surface, never gets narrower than 28rem: the side panes are clamped around it.
   */
  const [widths, setWidths] = useState<{ rail: number | null; panel: number | null }>(() => {
    try {
      const v = JSON.parse(window.localStorage.getItem('cqa-pane-widths') ?? 'null') as { rail?: unknown; panel?: unknown } | null;
      return { rail: typeof v?.rail === 'number' ? v.rail : null, panel: typeof v?.panel === 'number' ? v.panel : null };
    } catch {
      return { rail: null, panel: null };
    }
  });
  const setWidth = (k: 'rail' | 'panel', px: number | null) =>
    setWidths((w) => {
      const next = { ...w, [k]: px };
      try {
        window.localStorage.setItem('cqa-pane-widths', JSON.stringify(next));
      } catch {
        /* per-browser convenience only */
      }
      return next;
    });
  const railRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  /** The rail is shown when it fits (1536px+) and was not collapsed; otherwise the transcript header carries the queue. */
  const wide = fits && !railHidden;
  const twoPane = useTwoPane();

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
      setCriterionId(route.name === 'dialog' ? route.criterion ?? null : null);
      setFocus(null);
      setStartError(null);
    }
  }, [selectedId, route.name === 'dialog' ? route.criterion : undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAll = useCallback(async (): Promise<Data> => {
    const [conversations, evaluations, checklists, appeals] = await Promise.all([api.listConversations(), api.listEvaluations(), api.listChecklists(), api.listAppeals()]);
    return { conversations, evaluations, checklists, appeals };
  }, [api]);
  const reload = useCallback(async () => setLoad({ status: 'ready', data: await fetchAll() }), [fetchAll]);

  useEffect(() => {
    let live = true;
    fetchAll().then(
      (data) => live && setLoad({ status: 'ready', data }),
      (e: unknown) => live && setLoad({ status: 'error', error: e }),
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
  const quickCounts = useMemo(() => (load.status === 'ready' ? counts(load.data.conversations, latest) : { all: 0, violations: 0, review: 0, unevaluated: 0 }), [load, latest]);
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
    if (route.name === 'dialog' && wide) {
      /* the queue rail is beside the dialog: its search field takes the focus */
    } else if (route.name !== 'list') {
      keepFocus.current = true;
      go({ name: 'list' });
    }
    setSearchFocus((n) => n + 1);
  }, [route.name, wide, go]);

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
    document.title = route.name === 'dialog' ? `${route.id} · CQA` : route.name === 'checklist' ? 'Чек-лист · CQA' : route.name === 'appeals' ? 'Апелляции · CQA' : 'Диалоги · CQA';
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

  /** Results the digit keys 1-9 open: the rows exactly as the panel lists them (sections, attention filter). */
  const shortcutResults = useMemo(() => {
    const list = selectedId ? byConversation.get(selectedId) : undefined;
    const ev = list?.find((e) => e.id === evaluationId);
    if (ev?.status !== 'completed' || load.status !== 'ready') return [];
    const checklist = load.data.checklists.find((c) => c.id === ev.checklistVersionId);
    return criterionGroups(ev, checklist, load.data.appeals.filter((a) => a.evaluationId === ev.id), onlyFlagged).flatMap((g) => g.rows);
  }, [byConversation, selectedId, evaluationId, load, onlyFlagged]);

  useEffect(() => {
    if (route.name !== 'dialog') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || (t instanceof Element && t.closest('input, textarea, select, [contenteditable]'))) return;
      // A form with unsent text (reason, objection) holds the screen even when focus slipped out of its field:
      // a stray Russian letter (о/л/т are J/K/N) must not switch dialogs and throw the draft away.
      if (document.querySelector('[data-draft="dirty"]')) return;
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

  if (load.status === 'loading') return <LoadingShell />;
  if (load.status === 'error') {
    return (
      <main className="grid h-full place-items-center bg-canvas p-4">
        <div role="alert" className="w-full max-w-md rounded-card bg-surface p-6 shadow-card">
          <h1 className="flex items-center gap-2 text-base font-semibold"><AlertTriangle aria-hidden className="size-5 text-danger" />Не удалось загрузить данные</h1>
          <p className="mt-2 text-sm">{humanError(load.error).text}</p>
          <p className="mt-2 text-sm text-muted">Ничего не потеряно: оценки хранятся на сервере.</p>
          {humanError(load.error).detail && <p className="mt-2 break-words text-xs text-muted">Подробности: {humanError(load.error).detail}</p>}
          <Button variant="primary" className="mt-4" onClick={() => { setLoad({ status: 'loading' }); reload().catch((e: unknown) => setLoad({ status: 'error', error: e })); }}>Повторить</Button>
        </div>
      </main>
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

  /** Numbered tags on the messages each criterion cites, so the reason for a grade is visible in the text itself. */
  const tags = new Map<number, Tag[]>();
  if (evaluation?.status === 'completed') {
    for (const r of evaluation.finalResults) {
      const crit = checklist?.criteria.find((c) => c.id === r.criterionId);
      const o = grade(crit, r);
      const tone = o.tone;
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
      setStartError(e);
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

  /** rem in px at the current (fluid) root size. */
  const rem = (n: number) => n * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
  /** Widest a side pane may get: whatever leaves the transcript its 28rem minimum next to the other side pane. */
  const sideMax = (k: 'rail' | 'panel') => {
    const total = (mainRef.current?.clientWidth || window.innerWidth) - rem(2) - (wide ? rem(2) : rem(1));
    const other = k === 'rail' ? panelRef.current?.offsetWidth ?? 0 : wide ? railRef.current?.offsetWidth ?? 0 : 0;
    return Math.max(rem(k === 'rail' ? 14 : 24), Math.min(total - other - rem(28), rem(k === 'rail' ? 28 : 60)));
  };
  const mode = api instanceof MockCqaApi ? 'mock' : 'http';
  const e = evaluation;

  /**
   * Title row of the transcript card. Next to the queue rail it is only the title; without the rail (narrower
   * screens) it also carries the queue controls, so the same navigation is never shown twice.
   */
  const toolbar = conversation && (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <Button variant="ghost" size="sm" aria-label="К списку диалогов" onClick={() => go({ name: 'list' })} className="-ml-3"><ArrowLeft aria-hidden className="size-4" /></Button>
        <h1 className="text-2xl font-semibold leading-8">{conversation.id}</h1>
        <p className="text-sm text-muted">{conversation.language} · {conversation.channel === 'voice call' ? 'звонок' : 'чат'} · {conversation.transcript.length} сообщений</p>
      </div>
      {!wide && (
        <div className="flex flex-wrap items-center gap-2">
          {fits && <Button variant="ghost" size="sm" aria-label="Показать очередь диалогов" title="Показать очередь" onClick={() => hideRail(false)}><PanelLeftOpen aria-hidden className="size-4" /></Button>}
          <Button variant="outline" size="sm" aria-label="Предыдущий диалог (K)" disabled={position <= 0} onClick={() => step(-1)}><ChevronLeft aria-hidden className="size-4" /></Button>
          <label className="sr-only" htmlFor="dialog-switch">Диалог</label>
          <Select id="dialog-switch" value={conversation.id} onChange={(ev) => go({ name: 'dialog', id: ev.target.value })} className="h-8 w-auto max-w-56 rounded-full text-sm font-medium">
            {position < 0 && <option value={conversation.id}>{conversation.id} (вне фильтра)</option>}
            {queue.map((id) => {
              const ev = latest.get(id);
              return <option key={id} value={id}>{id}{ev?.status === 'completed' ? ` · ${formatScore(ev.finalTotal)}` : ''}</option>;
            })}
          </Select>
          <Button variant="outline" size="sm" aria-label="Следующий диалог (J)" disabled={position < 0 || position >= queue.length - 1} onClick={() => step(1)}><ChevronRight aria-hidden className="size-4" /></Button>
          <p className="hidden min-w-16 text-sm text-muted sm:block" aria-live="polite">{position >= 0 ? `${position + 1} из ${queue.length}` : 'вне фильтра'}</p>
          <Button variant="outline" size="sm" disabled={!nextAttention} onClick={() => nextAttention && go({ name: 'dialog', id: nextAttention })} title="Следующий диалог с нарушением, ошибкой оценки или низкой уверенностью (N)" aria-label="К диалогу, требующему проверки (N)">
            <AlertTriangle aria-hidden className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <>
    <div className="flex h-full flex-col md:flex-row print:hidden">
      <a href="#content" onClick={(e) => { e.preventDefault(); document.getElementById('content')?.focus(); }} className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:text-canvas">Перейти к содержимому</a>
      <Sidebar
        active={route.name === 'checklist' ? 'checklist' : route.name === 'appeals' ? 'appeals' : 'dialogs'}
        pendingAppeals={data.appeals.filter((a) => a.status === 'pending').length}
        onNavigate={(to) => go(to === 'checklist' ? { name: 'checklist' } : to === 'appeals' ? { name: 'appeals' } : { name: 'list' })}
        theme={theme}
        onToggleTheme={toggleTheme}
        demo={mode === 'mock'}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {route.name === 'checklist' ? (
          <main id="content" tabIndex={-1} className="min-h-0 flex-1 bg-canvas outline-none">
            <ChecklistEditor checklists={data.checklists} conversationCount={data.conversations.length} onSave={saveChecklist} onEvaluate={evaluateWith} currentConversationId={lastDialogId} />
          </main>
        ) : route.name === 'appeals' ? (
          <main id="content" tabIndex={-1} className="min-h-0 flex-1 bg-canvas outline-none">
            <AppealsPage appeals={data.appeals} evaluations={data.evaluations} checklists={data.checklists} conversations={data.conversations} onOpen={(id, criterion) => go({ name: 'dialog', id, criterion })} />
          </main>
        ) : route.name === 'list' ? (
          <main id="content" tabIndex={-1} className="min-h-0 flex-1 bg-canvas outline-none">
            <DialogsPage conversations={data.conversations} latest={latest} checklists={data.checklists} filters={filters} onFilters={setFilters} onOpen={(id) => go({ name: 'dialog', id })} focusSignal={searchFocus} />
          </main>
        ) : !conversation ? (
          <main id="content" tabIndex={-1} className="p-6 text-sm outline-none">
            <p className="text-muted">Диалог «{selectedId}» не найден.</p>
            <Button className="mt-4" onClick={() => go({ name: 'list' })}>К списку диалогов</Button>
          </main>
        ) : (
          <>
            {!twoPane && (
              <header aria-label="Диалог" className="border-b border-line bg-surface px-4 pt-3">
                {toolbar}
                <nav aria-label="Разделы экрана" className="mt-2 flex gap-1 pb-2">
                  {([['evaluation', 'Оценка'], ['transcript', 'Транскрипт']] as const).map(([id, label]) => (
                    <button key={id} type="button" aria-pressed={pane === id} onClick={() => setPane(id)} className={cn('h-10 flex-1 rounded-full text-sm font-medium transition-colors', pane === id ? 'bg-brand-soft text-accent' : 'text-muted hover:bg-fill hover:text-ink')}>
                      {label}
                    </button>
                  ))}
                </nav>
              </header>
            )}

            <PlayerProvider conversation={conversation}>
            <main
              ref={mainRef}
              id="content"
              tabIndex={-1}
              style={{ '--rail': widths.rail ? `${widths.rail}px` : '17.5rem', '--panel': widths.panel ? `${widths.panel}px` : 'clamp(30rem, 30vw, 40rem)' } as React.CSSProperties}
              className={cn('grid min-h-0 flex-1 bg-canvas p-0 outline-none xl:p-4', wide ? 'xl:grid-cols-[var(--rail)_1rem_minmax(28rem,1fr)_1rem_var(--panel)]' : 'xl:grid-cols-[minmax(28rem,1fr)_1rem_var(--panel)]')}
            >
              {wide && (
                <div ref={railRef} className="min-h-0 overflow-hidden rounded-card bg-surface shadow-card">
                  <QueueRail conversations={data.conversations} latest={latest} ids={queue} selectedId={conversation.id} filters={filters} counts={quickCounts} onFilters={(patch) => setFilters((f) => ({ ...f, ...patch }))} query={filters.query} onQuery={(q) => setFilters((f) => ({ ...f, query: q }))} focusSignal={searchFocus} onSelect={(id) => go({ name: 'dialog', id })} onHide={() => hideRail(true)} />
                </div>
              )}
              {wide && <Splitter label="Ширина очереди" className="hidden xl:flex" measure={() => railRef.current?.offsetWidth ?? 0} min={rem(14)} max={sideMax('rail')} onChange={(px) => setWidth('rail', px)} onReset={() => setWidth('rail', null)} />}
              <div className={cn('min-h-0 flex-col bg-surface xl:rounded-card xl:shadow-card', pane === 'transcript' ? 'flex' : 'hidden xl:flex')}>
                <Transcript key={conversation.id} conversation={conversation} cited={cited} checkedRange={selectedResult?.evidence.length === 0 ? selectedResult.checkedRange : undefined} focus={focus} tags={tags} activeId={criterionId} onTag={(id) => { setCriterionId(id); setPane('evaluation'); }} toolbar={twoPane ? toolbar : null} />
              </div>
              <Splitter label="Ширина панели оценки" className="hidden xl:flex" invert measure={() => panelRef.current?.offsetWidth ?? 0} min={rem(24)} max={sideMax('panel')} onChange={(px) => setWidth('panel', px)} onReset={() => setWidth('panel', null)} />
              <div ref={panelRef} className={cn('min-h-0 flex-col overflow-hidden bg-surface xl:rounded-card xl:shadow-card', pane === 'evaluation' ? 'flex' : 'hidden xl:flex')}>
                <EvaluationPanel
                  key={conversation.id}
                  conversation={conversation}
                  evaluation={evaluation}
                  checklist={checklist}
                  selectedCriterionId={criterionId}
                  onSelectCriterion={(id) => setCriterionId((cur) => (cur === id ? null : id))}
                  onJump={jump}
                  onStart={start}
                  starting={starting}
                  startError={startError}
                  appeals={data.appeals.filter((a) => a.evaluationId === evaluationId)}
                  onCreateAppeal={async (cid, comment) => {
                    if (!evaluation) return;
                    await api.createAppeal({ evaluationId: evaluation.id, criterionId: cid, comment });
                    await reload();
                  }}
                  onDecideAppeal={async (input: DecideAppealInput) => {
                    await api.decideAppeal(input);
                    await reload(); // an override changes finalResults, the total and the violation flag; appeals are reloaded with it
                  }}
                  onCorrect={async (cid, c: Correction) => {
                    if (!evaluation) return;
                    await api.overrideCriterion({ evaluationId: evaluation.id, criterionId: cid, ...c });
                    await reload();
                  }}
                  onlyFlagged={onlyFlagged}
                  onOnlyFlagged={setOnlyFlagged}
                  demoMode={mode === 'mock'}
                  versions={list.map((ev, i) => ({ id: ev.id, label: `Версия ${versionOf(ev) ?? '?'}${i === list.length - 1 ? ' (последняя)' : ''}` }))}
                  onPickEvaluation={(id) => {
                    setPickedEvaluationId(id);
                    setCriterionId(null);
                  }}
                  newerChecklistVersion={newer}
                />
              </div>
            </main>
            </PlayerProvider>
          </>
        )}
      </div>
    </div>
    {route.name === 'dialog' && conversation && evaluation?.status === 'completed' && <PrintReport conversation={conversation} evaluation={evaluation} checklist={checklist} appeals={data.appeals.filter((x) => x.evaluationId === evaluation.id)} />}
    </>
  );
}
