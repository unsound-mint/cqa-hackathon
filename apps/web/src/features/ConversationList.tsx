import type { Channel, Conversation, Evaluation, Language } from '@cqa/contracts';
import { Headphones, MessagesSquare, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatScore } from '@/lib/present';

type Props = {
  conversations: Conversation[];
  /** Latest evaluation per conversation, if any. */
  evaluations: Map<string, Evaluation>;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const LANGS: (Language | 'all')[] = ['all', 'RU', 'KZ', 'EN'];
const CHANNELS: { value: Channel | 'all'; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'agent chat', label: 'Чат' },
  { value: 'voice call', label: 'Звонок' },
];

function Segment<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-md border border-line-strong bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('h-7 flex-1 rounded px-2 text-xs font-medium transition-colors', value === o.value ? 'bg-brand-dark text-white' : 'text-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ConversationList({ conversations, evaluations, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [lang, setLang] = useState<Language | 'all'>('all');
  const [channel, setChannel] = useState<Channel | 'all'>('all');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations.filter(
      (c) => (lang === 'all' || c.language === lang) && (channel === 'all' || c.channel === channel) && (!q || c.id.toLowerCase().includes(q) || c.transcript.some((m) => m.text.toLowerCase().includes(q))),
    );
  }, [conversations, query, lang, channel]);

  return (
    <section aria-label="Диалоги" className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-line p-3">
        <label className="relative block">
          <span className="sr-only">Поиск по номеру и тексту</span>
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Номер или текст диалога"
            className="h-9 w-full rounded-md border border-line-strong bg-surface pl-8 pr-3 text-sm placeholder:text-muted"
          />
        </label>
        <Segment label="Язык" value={lang} onChange={setLang} options={LANGS.map((l) => ({ value: l, label: l === 'all' ? 'Все' : l }))} />
        <Segment label="Канал" value={channel} onChange={setChannel} options={CHANNELS} />
        <p className="text-xs text-muted" aria-live="polite">
          {shown.length} из {conversations.length}
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="p-4 text-sm text-muted">Ничего не найдено. Измените поиск или фильтры.</p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          {shown.map((c) => {
            const ev = evaluations.get(c.id);
            const active = c.id === selectedId;
            const ChannelIcon = c.channel === 'voice call' ? Headphones : MessagesSquare;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  aria-current={active ? 'true' : undefined}
                  className={cn('flex w-full flex-col gap-1.5 px-3 py-3 text-left transition-colors hover:bg-brand-soft/60', active && 'bg-brand-soft shadow-[inset_3px_0_0_var(--color-brand)]')}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs font-medium">{c.id}</span>
                    {ev?.status === 'completed' ? (
                      <Badge tone={ev.seriousViolation ? 'danger' : 'success'}>{ev.seriousViolation ? 'Нарушение · ' : ''}{formatScore(ev.finalTotal)}</Badge>
                    ) : ev?.status === 'failed' ? (
                      <Badge tone="danger">Ошибка оценки</Badge>
                    ) : ev ? (
                      <Badge tone="warn">Оценивается</Badge>
                    ) : (
                      <Badge>Не оценён</Badge>
                    )}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    <Badge tone="dark">{c.language}</Badge>
                    <span className="inline-flex items-center gap-1">
                      <ChannelIcon aria-hidden className="size-3.5" />
                      {c.channel === 'voice call' ? 'Звонок' : 'Чат'}
                    </span>
                    <span>· {c.transcript.length} сообщ.</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
