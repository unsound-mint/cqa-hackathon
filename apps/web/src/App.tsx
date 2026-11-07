import type { Appeal, ChecklistVersion, Conversation, DecideAppealInput, Evaluation, SaveChecklistInput } from '@cqa/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from './ApiContext';
import { cn } from '@/lib/utils';
import { ChecklistEditor } from './features/ChecklistEditor';
import { ConversationList } from './features/ConversationList';
import { EvaluationPanel } from './features/EvaluationPanel';
import { Transcript, type Focus } from './features/Transcript';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Data = { conversations: Conversation[]; evaluations: Evaluation[]; checklists: ChecklistVersion[] };
type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: Data };
type Pane = 'list' | 'transcript' | 'evaluation';
type View = 'review' | 'checklist';

const PANES: { id: Pane; label: string }[] = [
  { id: 'list', label: 'Диалоги' },
  { id: 'transcript', label: 'Транскрипт' },
  { id: 'evaluation', label: 'Оценка' },
];

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const viewFromHash = (): View => (window.location.hash === '#/checklist' ? 'checklist' : 'review');

export function App() {
  const api = useApi();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [view, setView] = useState<View>(viewFromHash);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickedEvaluationId, setPickedEvaluationId] = useState<string | null>(null);
  const [criterionId, setCriterionId] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [pane, setPane] = useState<Pane>('list');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [appeals, setAppeals] = useState<Appeal[]>([]);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (v: View) => {
    window.location.hash = v === 'checklist' ? '#/checklist' : '#/';
    setView(v);
  };

  const fetchAll = useCallback(async (): Promise<Data> => {
    const [conversations, evaluations, checklists] = await Promise.all([api.listConversations(), api.listEvaluations(), api.listChecklists()]);
    return { conversations, evaluations, checklists };
  }, [api]);

  const reload = useCallback(async () => setLoad({ status: 'ready', data: await fetchAll() }), [fetchAll]);

  useEffect(() => {
    let live = true;
    fetchAll().then(
      (data) => {
        if (!live) return;
        setLoad({ status: 'ready', data });
        setSelectedId((cur) => cur ?? data.conversations[0]?.id ?? null);
      },
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

  const select = (id: string) => {
    setSelectedId(id);
    setPickedEvaluationId(null);
    setCriterionId(null);
    setFocus(null);
    setStartError(null);
    setPane('transcript');
  };

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
    const ids = scope === 'all' ? data.conversations.map((c) => c.id) : selectedId ? [selectedId] : [];
    await runJob(ids, checklistVersionId);
  };

  const mode = import.meta.env.VITE_API_MODE ?? 'mock';
  const show = (p: Pane) => (pane === p ? 'flex' : 'hidden xl:flex');
  const tab = (v: View, label: string) => (
    <button type="button" onClick={() => go(v)} aria-current={view === v ? 'page' : undefined} className={cn('h-8 rounded-md px-3 text-sm font-medium transition-colors', view === v ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white')}>
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 bg-brand-dark px-4 text-white">
        <div className="flex min-w-0 items-center gap-6">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-7 place-items-center rounded-md bg-brand text-sm font-bold text-ink">Q</span>
            <div className="leading-tight">
              <h1 className="text-sm font-semibold">CQA · Контроль качества диалогов</h1>
              <p className="hidden text-xs text-white/70 lg:block">Проверка работы операторов по чек-листу</p>
            </div>
          </div>
          <nav aria-label="Разделы" className="flex gap-1">
            {tab('review', 'Диалоги')}
            {tab('checklist', 'Чек-лист')}
          </nav>
        </div>
        {mode === 'mock' && <Badge tone="warn" className="hidden sm:inline-flex">Демо-режим: вымышленные данные</Badge>}
      </header>

      {view === 'checklist' ? (
        <main className="min-h-0 flex-1 bg-canvas">
          <ChecklistEditor checklists={data.checklists} conversationCount={data.conversations.length} onSave={saveChecklist} onEvaluate={evaluateWith} hasCurrentConversation={!!selectedId} />
        </main>
      ) : (
        <>
          <nav aria-label="Разделы экрана" className="flex gap-1 border-b border-line bg-surface p-2 xl:hidden">
            {PANES.map((p) => (
              <button key={p.id} type="button" aria-pressed={pane === p.id} onClick={() => setPane(p.id)} className={cn('h-8 flex-1 rounded-md text-sm font-medium', pane === p.id ? 'bg-brand-dark text-white' : 'text-muted')}>
                {p.label}
              </button>
            ))}
          </nav>
          <main className="grid min-h-0 flex-1 xl:grid-cols-[300px_minmax(0,1fr)_440px]">
            <div className={cn('min-h-0 flex-col border-r border-line bg-surface', show('list'))}>
              <ConversationList conversations={data.conversations} evaluations={latest} selectedId={selectedId} onSelect={select} />
            </div>
            <div className={cn('min-h-0 flex-col', show('transcript'))}>
              {conversation ? (
                <Transcript conversation={conversation} cited={cited} checkedRange={selectedResult?.evidence.length === 0 ? selectedResult.checkedRange : undefined} focus={focus} />
              ) : (
                <p className="p-6 text-sm text-muted">{data.conversations.length ? 'Выберите диалог слева.' : 'Диалогов пока нет. Импортируйте набор данных.'}</p>
              )}
            </div>
            <div className={cn('min-h-0 flex-col border-l border-line bg-canvas', show('evaluation'))}>
              {conversation && (
                <EvaluationPanel
                  conversation={conversation}
                  evaluation={evaluation}
                  checklist={checklist}
                  selectedCriterionId={criterionId}
                  onSelectCriterion={(id) => setCriterionId((cur) => (cur === id ? null : id))}
                  onJump={(index) => {
                    setPane('transcript');
                    setFocus((f) => ({ index, nonce: (f?.nonce ?? 0) + 1 }));
                  }}
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
              )}
            </div>
          </main>
        </>
      )}
    </div>
  );
}
