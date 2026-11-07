import { ListChecks, MessagesSquare, Moon, Search, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  active: 'dialogs' | 'checklist';
  onNavigate: (to: 'dialogs' | 'checklist') => void;
  onSearch: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  demo: boolean;
};

/** Slim navigation rail: tabs on top, global tools (search, theme, demo label) at the bottom. A top bar on narrow screens. */
export function Sidebar({ active, onNavigate, onSearch, theme, onToggleTheme, demo }: Props) {
  const ThemeIcon = theme === 'dark' ? Sun : Moon;
  const item = (id: 'dialogs' | 'checklist', label: string, Icon: typeof MessagesSquare, href: string) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        onNavigate(id);
      }}
      aria-current={active === id ? 'page' : undefined}
      className={cn('flex min-h-12 min-w-16 flex-col items-center justify-center gap-1 rounded-xl px-1 text-xs transition-colors', active === id ? 'bg-brand-soft font-medium text-accent' : 'text-muted hover:bg-fill hover:text-ink')}
    >
      <Icon aria-hidden className="size-5" />
      {label}
    </a>
  );
  const tool = 'grid size-12 place-items-center rounded-xl text-muted transition-colors hover:bg-fill hover:text-ink';
  return (
    <aside className="flex shrink-0 flex-row items-center gap-4 border-b border-line bg-surface px-4 py-2 md:h-full md:w-[72px] md:flex-col md:items-stretch md:gap-0 md:border-b-0 md:border-r md:px-2 md:py-4">
      <div className="flex items-center justify-center gap-1 md:mb-4" aria-label="CQA">
        <span className="text-base font-semibold tracking-wide">CQA</span>
        <span aria-hidden className="size-2 rounded-full bg-brand" />
      </div>
      <nav aria-label="Разделы" className="flex flex-1 flex-row gap-1 md:flex-none md:flex-col md:items-center">
        {item('dialogs', 'Диалоги', MessagesSquare, '#/')}
        {item('checklist', 'Чек-лист', ListChecks, '#/checklist')}
      </nav>
      <div className="flex flex-row items-center gap-1 md:mt-auto md:flex-col">
        {demo && <span title="Вымышленные данные: демо без сервера" className="inline-flex h-6 items-center rounded-full bg-warn-soft px-2 text-xs font-medium text-warn md:mb-2">Демо</span>}
        <button type="button" onClick={onSearch} aria-label="Найти диалог (Ctrl K)" title="Найти диалог (Ctrl K)" className={tool}>
          <Search aria-hidden className="size-5" />
        </button>
        <button type="button" onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'} title="Тема" className={tool}>
          <ThemeIcon aria-hidden className="size-5" />
        </button>
      </div>
    </aside>
  );
}
