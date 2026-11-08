import type { Notification } from '@cqa/contracts';
import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type Props = { notifications: Notification[]; onOpen: (n: Notification) => void; onReadAll: () => void };

const KIND: Record<Notification['kind'], string> = { critical: 'Нарушение', comment: 'Комментарий', appeal: 'Апелляция', task: 'Задача', crosscheck: 'Контроль' };
const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** The inbox: serious violations in a manager's team, comments for an operator, tasks for QA. Unread first. */
export function NotificationsBell({ notifications, onOpen, onReadAll }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const unread = notifications.filter((n) => !n.readAt).length;
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog" aria-label={unread ? `Уведомления: ${unread} новых` : 'Уведомления'} title="Уведомления" className="relative grid size-10 place-items-center rounded-xl text-muted transition-colors hover:bg-fill hover:text-ink md:size-12">
        <Bell aria-hidden className="size-5" />
        {unread > 0 && <span aria-hidden className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-xs font-semibold leading-4 text-canvas">{unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Уведомления" className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-surface p-2 text-left text-sm text-ink shadow-card md:bottom-0 md:left-full md:right-auto md:top-auto md:ml-2 md:mt-0">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-xs font-medium">Уведомления</p>
            {unread > 0 && <button type="button" onClick={onReadAll} className="text-xs text-accent underline-offset-2 hover:underline">Прочитать все</button>}
          </div>
          {notifications.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted">Пока ничего нет. Здесь появятся грубые нарушения в вашей группе, комментарии и задачи.</p>
          ) : (
            <ul className="max-h-96 space-y-1 overflow-auto">
              {notifications.slice(0, 30).map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => { setOpen(false); onOpen(n); }} className={cn('w-full rounded-xl px-3 py-2 text-left hover:bg-fill', !n.readAt && 'bg-brand-soft/60')}>
                    <span className="flex items-center justify-between gap-2 text-xs text-muted"><span className={cn(n.kind === 'critical' && 'font-medium text-danger')}>{KIND[n.kind]}</span><span className="tabular-nums">{when(n.at)}</span></span>
                    <span className="block font-medium">{n.title}</span>
                    <span className="line-clamp-2 block text-xs text-muted">{n.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
