import { ROLE_LABELS, type Actor, type Role } from '@cqa/contracts';
import { ClipboardCheck, Headset, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const ROLES: { role: Role; Icon: LucideIcon; about: string }[] = [
  { role: 'operator', Icon: Headset, about: 'Видит только свои диалоги и может оспорить оценку.' },
  { role: 'reviewer', Icon: ClipboardCheck, about: 'Очередь проверки: отмечает проверенное, правит оценки, решает апелляции.' },
  { role: 'lead', Icon: ShieldCheck, about: 'Всё то же, а также чек-лист, назначение операторов и разбор по операторам.' },
];

type Props = { identity: Actor; operators: string[]; onChange: (next: Actor) => void };

/**
 * Who is using the app. There is no login in the demo: the choice is sent with every request and the server limits
 * what that role can see and do. Not security; it keeps the three responsibilities apart.
 */
export function RolePicker({ identity, operators, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>(identity.role);
  const [name, setName] = useState(identity.name);
  const box = useRef<HTMLDivElement>(null);
  const Icon = ROLES.find((r) => r.role === identity.role)!.Icon;

  useEffect(() => {
    if (!open) return;
    setRole(identity.role);
    setName(identity.name);
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open, identity.role, identity.name]);

  const pick = (r: Role) => {
    setRole(r);
    setName(r === 'operator' ? (operators.includes(name) ? name : operators[0] ?? '') : ROLE_LABELS[r]);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (role === 'operator' && !name.trim()) return;
    onChange({ role, name: name.trim() || ROLE_LABELS[role] });
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Роль: ${ROLE_LABELS[identity.role]}, ${identity.name}. Сменить`}
        title="Сменить роль"
        className="flex min-h-12 w-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-xs text-muted transition-colors hover:bg-fill hover:text-ink md:w-full"
      >
        <Icon aria-hidden className="size-5" />
        <span className="w-full truncate text-center">{identity.name}</span>
      </button>
      {open && (
        <form
          role="dialog"
          aria-label="Роль в демо"
          onSubmit={submit}
          className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] space-y-3 rounded-card border border-line bg-surface p-4 text-left text-sm text-ink shadow-card md:bottom-0 md:left-full md:right-auto md:top-auto md:ml-2 md:mt-0"
        >
          <fieldset className="space-y-1">
            <legend className="mb-1 text-xs font-medium">Работать как</legend>
            {ROLES.map(({ role: r, Icon: I, about }) => (
              <label key={r} className={cn('flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2', role === r ? 'bg-brand-soft' : 'hover:bg-fill')}>
                <input type="radio" name="demo-role" checked={role === r} onChange={() => pick(r)} className="mt-1 size-4 accent-brand" />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-medium"><I aria-hidden className="size-4" />{ROLE_LABELS[r]}</span>
                  <span className="block text-xs text-muted">{about}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="space-y-1">
            <label htmlFor="demo-name" className="text-xs font-medium">{role === 'operator' ? 'Какой оператор' : 'Ваше имя'}</label>
            <input
              id="demo-name"
              list={role === 'operator' ? 'demo-operators' : undefined}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required={role === 'operator'}
              className="h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm"
            />
            {role === 'operator' && <datalist id="demo-operators">{operators.map((o) => <option key={o} value={o} />)}</datalist>}
            <p className="text-xs text-muted">{role === 'operator' ? (operators.length ? 'Выберите из назначенных или впишите имя.' : 'Пока никому не назначены диалоги: их назначает руководитель.') : 'Подпишет ваши решения.'}</p>
          </div>
          <p className="text-xs text-muted">Входа в демо нет: роль только разделяет обязанности.</p>
          <Button type="submit" variant="primary" size="sm" disabled={role === 'operator' && !name.trim()}>Применить</Button>
        </form>
      )}
    </div>
  );
}
