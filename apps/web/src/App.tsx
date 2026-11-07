import { useEffect, useState } from 'react';
import type { ChecklistVersion, Conversation, Evaluation } from '@cqa/contracts';
import { useApi } from './ApiContext';

/** Foundation smoke view only: proves the contract + mock work. Sofia replaces this with the real workspace. */
export function App() {
  const api = useApi();
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; conversation: Conversation; evaluation: Evaluation; checklist: ChecklistVersion }
  >({ status: 'loading' });

  useEffect(() => {
    (async () => {
      const [conversation] = await api.listConversations();
      if (!conversation) throw new Error('no conversations');
      const [evaluation] = await api.listEvaluations({ conversationId: conversation.id });
      if (!evaluation) throw new Error('no evaluation');
      const checklist = (await api.listChecklists()).find((c) => c.id === evaluation.checklistVersionId);
      if (!checklist) throw new Error('checklist missing');
      setState({ status: 'ready', conversation, evaluation, checklist });
    })().catch((e: unknown) => setState({ status: 'error', message: e instanceof Error ? e.message : String(e) }));
  }, [api]);

  if (state.status === 'loading') return <p>Loading…</p>;
  if (state.status === 'error') return <p role="alert">Error: {state.message}</p>;
  const { conversation, evaluation, checklist } = state;

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <h1>CQA</h1>
      {evaluation.provenance?.provider === 'mock' && <p><strong>MOCK DATA</strong> — fictional fixture, not a live evaluation.</p>}
      <h2>{conversation.id} <small>({conversation.language}, {conversation.channel})</small></h2>
      <ol start={0} style={{ listStyle: 'none', padding: 0 }}>
        {conversation.transcript.map((m) => (
          <li key={m.index} id={`msg-${m.index}`}>
            <code>[{m.index}] {m.timestamp}</code> <strong>{m.speaker}</strong>: {m.text}
          </li>
        ))}
      </ol>
      <h2>Total: {evaluation.finalTotal ?? 'n/a'}</h2>
      <ul>
        {evaluation.finalResults.map((r) => {
          const c = checklist.criteria.find((x) => x.id === r.criterionId);
          return (
            <li key={r.criterionId}>
              {r.criterionId} {c?.title} (weight {c?.weight}): {r.isNA ? `N/A — ${r.naReason ?? ''}` : String(r.value)}
              {r.evidence.length > 0 && <> — evidence: {r.evidence.map((e) => e.messageIndex).join(', ')}</>}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
