import { ChartNoAxesColumn, ClipboardList, Gavel, ListChecks, MessagesSquare, Moon, ScrollText, Sun, TrendingUp, UsersRound } from 'lucide-react';
import type { Actor, Notification, Person } from '@cqa/contracts';
import { cn } from '@/lib/utils';
import { NotificationsBell } from './NotificationsBell';
import { RolePicker } from './RolePicker';

export type Section = 'dialogs' | 'tasks' | 'appeals' | 'analytics' | 'team' | 'audit' | 'checklist' | 'stats';

type Props = {
  active: Section;
  /** Appeals waiting for a decision: shown as a count on the Апелляции item. */
  pendingAppeals: number;
  onNavigate: (to: Section) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  demo: boolean;
  identity: Actor;
  people: Person[];
  onIdentity: (next: Actor) => void;
  /** Sections this role has; the others are not shown. */
  sections: Section[];
  notifications: Notification[];
  onNotification: (n: Notification) => void;
  onReadNotifications: () => void;
  openTasks: number;
};

/** Slim navigation rail: tabs on top, global tools (theme, demo label) at the bottom. A top bar on narrow screens. */
export function Sidebar({ active, pendingAppeals, onNavigate, theme, onToggleTheme, demo, identity, people, onIdentity, sections, notifications, onNotification, onReadNotifications, openTasks }: Props) {
  const ThemeIcon = theme === 'dark' ? Sun : Moon;
  const item = (id: Section, label: string, Icon: typeof MessagesSquare, href: string, count = 0) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        onNavigate(id);
      }}
      aria-current={active === id ? 'page' : undefined}
      className={cn('flex min-h-12 min-w-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-xs transition-colors md:w-full', active === id ? 'bg-brand-soft font-medium text-accent' : 'text-muted hover:bg-fill hover:text-ink')}
    >
      <span className="relative">
        <Icon aria-hidden className="size-5" />
        {count > 0 && <span aria-label={`${count} ждут решения`} className="absolute -right-2 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-warn px-1 text-xs font-semibold leading-4 text-canvas">{count}</span>}
      </span>
      {label}
    </a>
  );
  const tool = 'grid size-10 place-items-center md:size-12 rounded-xl text-muted transition-colors hover:bg-fill hover:text-ink';
  return (
    <aside className="flex shrink-0 flex-row items-center gap-2 border-b border-line bg-surface px-2 py-2 sm:gap-4 sm:px-4 md:h-full md:w-[4.5rem] md:flex-col md:items-stretch md:gap-0 md:border-b-0 md:border-r md:px-1 md:py-4">
      <div className="flex shrink-0 items-center justify-center gap-1 md:mb-4" aria-label="CQA">
        <span className="text-base font-semibold tracking-wide">CQA</span>
        <span aria-hidden className="size-2 rounded-full bg-brand" />
      </div>
      <nav aria-label="Разделы" className="flex min-w-0 flex-1 flex-row gap-1 overflow-x-auto md:min-h-0 md:flex-1 md:flex-col md:items-center md:overflow-y-auto md:overflow-x-hidden">
        {sections.includes('dialogs') && item('dialogs', 'Диалоги', MessagesSquare, '#/')}
        {sections.includes('tasks') && item('tasks', 'Задачи', ClipboardList, '#/tasks', openTasks)}
        {sections.includes('appeals') && item('appeals', 'Апелляции', Gavel, '#/appeals', pendingAppeals)}
        {sections.includes('stats') && item('stats', 'Статистика', ChartNoAxesColumn, '#/stats')}
        {sections.includes('analytics') && item('analytics', 'Аналитика', TrendingUp, '#/analytics')}
        {sections.includes('team') && item('team', 'Команда', UsersRound, '#/team')}
        {sections.includes('audit') && item('audit', 'Журнал', ScrollText, '#/audit')}
        {sections.includes('checklist') && item('checklist', 'Чек-лист', ListChecks, '#/checklist')}
      </nav>
      <div className="flex shrink-0 flex-row items-center gap-1 md:mt-auto md:flex-col">
        {demo && <span title="Вымышленные данные: демо без сервера" className="inline-flex h-6 items-center rounded-full bg-warn-soft px-2 text-xs font-medium text-warn md:mb-2">Демо</span>}
        <NotificationsBell notifications={notifications} onOpen={onNotification} onReadAll={onReadNotifications} />
        <RolePicker identity={identity} people={people} onChange={onIdentity} />
        <button type="button" onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'} title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} className={tool}>
          <ThemeIcon aria-hidden className="size-5" />
        </button>
      </div>
    </aside>
  );
}
