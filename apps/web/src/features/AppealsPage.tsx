import type { Actor, Appeal, ChecklistVersion, Conversation, Evaluation } from '@cqa/contracts';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { grade } from '@/lib/present';

type Props = {
  appeals: Appeal[];
  evaluations: Evaluation[];
  checklists: ChecklistVersion[];
  conversations: Conversation[];
  onOpen: (conversationId: string, criterionId: string) => void;
  identity: Actor;
};

type Filter = 'pending' | 'decided' | 'all';

const fmt = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
const STATUS = { pending: { label: 'На рассмотрении', tone: 'warn' }, upheld: { label: 'Оценка ИИ оставлена', tone: 'neutral' }, overridden: { label: 'Оценка изменена', tone: 'neutral' } } as const;

/**
 * Appeals by role. A reviewer or lead gets the approver's queue (across all dialogs; opening one lands on the criterion with
 * the decision form). An operator gets their own appeals and what was decided; the server already limits the list to them.
 */
export function AppealsPage({ appeals: all, evaluations, checklists, conversations, onOpen, identity }: Props) {
  const mine = identity.role === 'operator';
  const [filter, setFilter] = useState<Filter>('pending');
  // Direct corrections by a reviewer are audit history of a dialog, not disputes: they never enter this queue.
  const appeals = useMemo(() => all.filter((a) => a.kind !== 'correction'), [all]);
  const pending = appeals.filter((a) => a.status === 'pending').length;

  const rows = useMemo(() => {
    const list = appeals.filter((a) => (filter === 'pending' ? a.status === 'pending' : filter === 'decided' ? a.status !== 'pending' : true));
    // Waiting appeals oldest first (the longest wait on top); decided ones newest decision first.
    return [...list].sort((a, b) => (a.status === 'pending' && b.status === 'pending' ? a.createdAt.localeCompare(b.createdAt) : a.status === 'pending' ? -1 : b.status === 'pending' ? 1 : (b.decidedAt ?? '').localeCompare(a.decidedAt ?? '')));
  }, [appeals, filter]);

  const chip = (f: Filter, label: string, n: number) => (
    <button type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={cn('inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm transition-colors', filter === f ? 'border-ink bg-ink text-canvas' : 'border-line bg-surface hover:border-line-strong')}>
      {label}
      <span className={cn('tabular-nums', filter === f ? 'opacity-80' : 'text-muted')}>{n}</span>
    </button>
  );

  return (
    <section aria-label="Апелляции" className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold leading-8">{mine ? 'Мои апелляции' : 'Апелляции'}</h1>
        <p className="max-w-prose text-sm text-muted">{mine ? 'Оценки, которые вы оспорили, и решения по ним. Решение принимает проверяющий; до решения балл не меняется.' : 'Оценки, которые оператор оспорил. Откройте обращение, чтобы подтвердить оценку ИИ или изменить её с указанием причины. Исходный ответ ИИ сохраняется всегда.'}</p>
      </div>

      <div role="group" aria-label="Что показать" className="flex flex-wrap gap-2">
        {chip('pending', 'На рассмотрении', pending)}
        {chip('decided', 'Решённые', appeals.length - pending)}
        {chip('all', 'Все', appeals.length)}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-card border border-line bg-surface p-6 text-sm text-muted">
          {appeals.length === 0 ? (mine ? 'Вы пока ничего не оспаривали. Откройте свой диалог, выберите критерий и нажмите «Оспорить оценку».' : 'Апелляций пока нет. Оператор может оспорить оценку в карточке диалога; чтобы попробовать, смените роль на «Оператор».') : filter === 'pending' ? 'Нет обращений, ожидающих решения.' : 'Нет решённых обращений.'}
        </div>
      ) : (
        <div className="min-h-0 overflow-auto rounded-card border border-line bg-surface shadow-card">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Апелляции</caption>
            <thead className="sticky top-0 z-10 bg-surface text-xs text-muted shadow-[0_1px_0_var(--c-line)]">
              <tr className="h-10 text-left">
                <th scope="col" className="px-3 font-medium">Диалог и критерий</th>
                <th scope="col" className="hidden px-3 font-medium md:table-cell">Возражение</th>
                <th scope="col" className="hidden px-3 font-medium sm:table-cell">Оценка</th>
                <th scope="col" className="hidden px-3 font-medium sm:table-cell">Подана</th>
                {!mine && <th scope="col" className="hidden px-3 font-medium lg:table-cell">Оператор</th>}
                <th scope="col" className="px-3 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((a) => {
                const ev = evaluations.find((e) => e.id === a.evaluationId);
                const conv = conversations.find((c) => c.id === ev?.conversationId);
                const checklist = checklists.find((c) => c.id === ev?.checklistVersionId);
                const criterion = checklist?.criteria.find((c) => c.id === a.criterionId);
                const original = ev?.originalResults.find((r) => r.criterionId === a.criterionId);
                const final = ev?.finalResults.find((r) => r.criterionId === a.criterionId);
                const changed = a.status === 'overridden' && original && final;
                return (
                  <tr key={a.id} onClick={() => conv && onOpen(conv.id, a.criterionId)} className={cn('align-top', conv && 'cursor-pointer hover:bg-brand-soft/60')}>
                    <td className="px-3 py-3">
                      {conv ? (
                        <a href={`#/dialog/${encodeURIComponent(conv.id)}?criterion=${encodeURIComponent(a.criterionId)}`} onClick={(e) => e.stopPropagation()} className="inline-flex min-h-6 items-center text-base font-medium text-accent underline-offset-2 hover:underline">{conv.id}</a>
                      ) : (
                        <span className="text-base font-medium">Диалог не найден</span>
                      )}
                      <div className="text-sm">{a.criterionId} {criterion?.title}</div>
                      <p className="mt-1 text-xs text-muted md:hidden">{a.comment}</p>
                      <p className="mt-1 text-xs tabular-nums sm:hidden">{original && `ИИ: ${grade(criterion, original).label}`}{changed && final ? ` → ${grade(criterion, final).label}` : ''}</p>
                    </td>
                    <td className="hidden max-w-md px-3 py-3 md:table-cell"><p className="line-clamp-3 max-w-[65ch] text-sm">{a.comment}</p></td>
                    <td className="hidden px-3 py-3 whitespace-nowrap tabular-nums sm:table-cell">
                      {original && <span className={changed ? 'text-muted line-through' : ''} title="Ответ ИИ">ИИ: {grade(criterion, original).label}</span>}
                      {changed && final && <div className="font-medium">Итог: {grade(criterion, final).label}</div>}
                    </td>
                    <td className="hidden px-3 py-3 text-muted sm:table-cell">{fmt(a.createdAt)}</td>
                    {!mine && <td className="hidden px-3 py-3 lg:table-cell">{a.createdBy ?? conv?.operatorId ?? <span className="text-muted">—</span>}</td>}
                    <td className="px-3 py-3 text-right sm:text-left">
                      <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
                      {a.status !== 'pending' && (a.reviewerReason || a.decidedBy) && <p className="mt-1 max-w-xs text-xs text-muted">{a.decidedBy ? `${a.decidedBy}: ` : ''}{a.reviewerReason}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
