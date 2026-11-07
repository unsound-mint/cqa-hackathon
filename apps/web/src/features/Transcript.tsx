import type { Conversation, Speaker } from '@cqa/contracts';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { SPEAKER_LABEL } from '@/lib/present';

export type Focus = { index: number; nonce: number } | null;

type Props = {
  conversation: Conversation;
  /** Messages cited as evidence by the selected criterion. */
  cited: ReadonlySet<number>;
  /** Range inspected for an absence claim (inclusive). */
  checkedRange?: { from: number; to: number };
  /** Set when an evidence chip is clicked; `nonce` makes repeated clicks on the same message re-trigger. */
  focus: Focus;
};

const ROW: Record<Speaker, string> = {
  client: 'border-line bg-surface',
  operator: 'border-brand-dark/25 bg-brand-soft/50',
  bot: 'border-dashed border-line-strong bg-canvas text-muted',
  system: 'border-transparent bg-transparent text-muted italic',
};

export function Transcript({ conversation, cited, checkedRange, focus }: Props) {
  const refs = useRef(new Map<number, HTMLLIElement>());

  useEffect(() => {
    if (!focus) return;
    const el = refs.current.get(focus.index);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
    el.classList.remove('flash');
    void el.offsetWidth; // restart the animation on repeated clicks
    el.classList.add('flash');
  }, [focus]);

  return (
    <section aria-label="Транскрипт" className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="font-mono text-sm font-semibold">{conversation.id}</h2>
          <p className="text-xs text-muted">
            {conversation.language} · {conversation.channel === 'voice call' ? 'звонок' : 'чат'} · {conversation.transcript.length} сообщений · индексы с нуля, время как в исходнике
          </p>
        </div>
        {conversation.audioUrl && <audio controls preload="none" src={conversation.audioUrl} aria-label="Запись звонка" className="h-8 max-w-full" />}
      </header>
      <ol start={0} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-4">
        {conversation.transcript.map((m) => {
          const isCited = cited.has(m.index);
          const inChecked = checkedRange && m.index >= checkedRange.from && m.index <= checkedRange.to;
          return (
            <li
              key={m.index}
              id={`msg-${m.index}`}
              ref={(el) => {
                if (el) refs.current.set(m.index, el);
                else refs.current.delete(m.index);
              }}
              tabIndex={-1}
              data-cited={isCited || undefined}
              className={cn(
                'grid grid-cols-[3.25rem_1fr] gap-x-3 rounded-lg border px-3 py-2 text-sm outline-none',
                ROW[m.speaker],
                isCited && 'border-brand ring-2 ring-brand/40',
                !isCited && inChecked && 'border-l-4 border-l-line-strong',
                m.speaker === 'system' && 'py-1 text-xs',
              )}
            >
              <span className="select-none font-mono text-xs leading-6 text-muted">
                <span className="block">#{m.index}</span>
                <span className="block text-[11px]">{m.timestamp}</span>
              </span>
              <span className="min-w-0">
                <span className={cn('mr-2 text-xs font-semibold not-italic', m.speaker === 'operator' ? 'text-brand-dark' : 'text-muted')}>{SPEAKER_LABEL[m.speaker]}</span>
                <span className="whitespace-pre-wrap break-words">{m.text}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
