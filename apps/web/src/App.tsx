import type { ChecklistVersion, Conversation, Evaluation } from '@cqa/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApi } from './ApiContext';
import { cn } from '@/lib/utils';
import { ConversationList } from './features/ConversationList';
import { EvaluationPanel } from './features/EvaluationPanel';
import { Transcript, type Focus } from './features/Transcript';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Data = { conversations: Conversation[]; evaluations: Evaluation[]; checklists: ChecklistVersion[] };
type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: Data };
type Pane = 'list' | 'transcript' | 'evaluation';

const PANES: { id: Pane; label: string }[] = [
  { id: 'list', label: 'Диалоги' },
  { id: 'transcript', label: 'Транскрипт' },
  { id: 'evaluation', label: 'Оценка' },
];

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function App() {
  const api = useApi();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [criterionId, setCriterionId] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [pane, setPane] = useState<Pane>('list');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const fetchAll = useCallback(async (): Promise<Data> => {
    const [conversations, evaluations, checklists] = await Promise.all([api.listConversations(), api.listEvaluations(), api.listChecklists()]);
    return { conversations, evaluations, checklists };
  }, [api]);

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

  /** Latest evaluation per conversation (the API lists oldest first). */
  const latest = useMemo(() => {
    const m = new Map<string, Evaluation>();
    if (load.status === 'ready') for (const e of load.data.evaluations) m.set(e.conversationId, e);
    return m;
  }, [load]);

  const select = (id: string) => {
    setSelectedId(id);
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
        <Button className="mt-3" onClick={() => { setLoad({ status: 'loading' }); fetchAll().then((data) => setLoad({ status: 'ready', data }), (e: unknown) => setLoad({ status: 'error', message: errorText(e) })); }}>Повторить</Button>
      </div>
    );
  }

  const { data } = load;
  const conversation = data.conversations.find((c) => c.id === selectedId);
  const evaluation = selectedId ? latest.get(selectedId) : undefined;
  const newestChecklist = [...data.checklists].sort((a, b) => b.version - a.version)[0];
  const checklist = data.checklists.find((c) => c.id === evaluation?.checklistVersionId) ?? newestChecklist;
  const selectedResult = evaluation?.finalResults.find((r) => r.criterionId === criterionId);
  const cited = new Set((selectedResult?.evidence ?? []).filter((e) => conversation?.transcript[e.messageIndex]).map((e) => e.messageIndex));

  const start = async () => {
    if (!selectedId || !newestChecklist) return;
    setStarting(true);
    setStartError(null);
    try {
      const { jobId } = await api.startEvaluation({ conversationIds: [selectedId], checklistVersionId: newestChecklist.id });
      for (;;) {
        const job = await api.getJob(jobId);
        if (job.status === 'completed' || job.status === 'failed') break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      setLoad({ status: 'ready', data: await fetchAll() });
    } catch (e) {
      setStartError(errorText(e));
    } finally {
      setStarting(false);
    }
  };

  const mode = import.meta.env.VITE_API_MODE ?? 'mock';
  const show = (p: Pane) => (pane === p ? 'flex' : 'hidden xl:flex');

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between bg-brand-dark px-4 text-white">
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid size-7 place-items-center rounded-md bg-brand text-sm font-bold text-ink">Q</span>
          <div className="leading-tight">
            <h1 className="text-sm font-semibold">CQA · Контроль качества диалогов</h1>
            <p className="hidden text-xs text-white/70 sm:block">Проверка работы операторов по чек-листу</p>
          </div>
        </div>
        {mode === 'mock' && <Badge tone="warn">Демо-режим: вымышленные данные</Badge>}
      </header>

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
            />
          )}
        </div>
      </main>
    </div>
  );
}
