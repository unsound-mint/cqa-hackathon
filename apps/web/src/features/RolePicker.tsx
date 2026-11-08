import { ROLE_LABELS, type Actor, type Person, type Role } from '@cqa/contracts';
import { ClipboardCheck, Headset, Settings, ShieldCheck, UsersRound, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/error-note';
import { Select } from '@/components/ui/field';
import { cn } from '@/lib/utils';

const ROLES: { role: Role; Icon: LucideIcon; about: string }[] = [
  { role: 'operator', Icon: Headset, about: 'Видит только свои диалоги, комментарии к ним и может оспорить оценку.' },
  { role: 'reviewer', Icon: ClipboardCheck, about: 'Проверка: свои задачи, правка оценок, апелляции, контрольные проверки.' },
  { role: 'manager', Icon: UsersRound, about: 'Видит только свою группу: оценки, динамика, комментарии, уведомления.' },
  { role: 'lead', Icon: ShieldCheck, about: 'Все данные, задачи QA, контроль QA, чек-лист, события и журнал.' },
  { role: 'admin', Icon: Settings, about: 'Сотрудники, группы, импорт, журнал. Оценки не меняет.' },
];

type Props = { identity: Actor; people: Person[]; onChange: (next: Actor) => void; onSeedDemo?: () => Promise<void> };

/**
 * Who is using the app. There is no login in the demo: the choice is sent with every request and the server limits
 * what that role can see and do (an operator themselves, a manager their team). Not security; it keeps the
 * responsibilities apart. With a directory the person is picked from it; without one the name is typed.
 */
export function RolePicker({ identity, people, onChange, onSeedDemo }: Props) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>(identity.role);
  const [name, setName] = useState(identity.name);
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<unknown>(null);
  const box = useRef<HTMLDivElement>(null);
  const Icon = ROLES.find((r) => r.role === identity.role)!.Icon;
  const of = (r: Role) => people.filter((p) => p.role === r);
  /** The <select> shows the first person when the identity names nobody, so the state must hold that person too. */
  const initialPerson = () => (identity.id && of(identity.role).some((p) => p.id === identity.id) ? identity.id : of(identity.role)[0]?.id ?? '');
  const [personId, setPersonId] = useState(initialPerson);

  useEffect(() => {
    if (!open) return;
    setRole(identity.role);
    setPersonId(initialPerson());
    setName(identity.name);
    setSeedError(null);
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open, identity.role, identity.id, identity.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (r: Role) => {
    setRole(r);
    const first = of(r)[0];
    setPersonId(first?.id ?? '');
    setName(first?.name ?? ROLE_LABELS[r]);
  };
  const listed = of(role);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const person = listed.find((p) => p.id === (personId || listed[0]?.id));
    if (listed.length > 0 && !person) return;
    onChange(person ? { role, name: person.name, id: person.id } : { role, name: name.trim() || ROLE_LABELS[role] });
    setOpen(false);
  };

  return (
    <div ref={box} className="relative md:w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Роль: ${ROLE_LABELS[identity.role]}, ${identity.name}. Сменить`}
        title="Сменить роль"
        className="flex min-h-12 w-16 flex-col items-center justify-center gap-1 rounded-xl px-1 text-xs text-muted transition-colors hover:bg-fill hover:text-ink md:w-full"
      >
        <Icon aria-hidden className="size-5" />
        <span className="w-full min-w-0 truncate text-center font-medium leading-tight">{ROLE_LABELS[identity.role]}</span>
        <span className="line-clamp-2 w-full min-w-0 break-words text-center leading-tight">{identity.name}</span>
      </button>
      {open && (
        <form
          role="dialog"
          aria-label="Роль в демо"
          onSubmit={submit}
          className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] space-y-3 rounded-card border border-line bg-surface p-4 text-left text-sm text-ink shadow-card md:bottom-0 md:left-full md:right-auto md:top-auto md:ml-2 md:mt-0"
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
            <label htmlFor="demo-person" className="text-xs font-medium">{listed.length ? 'Кто именно' : 'Ваше имя'}</label>
            {listed.length ? (
              <Select id="demo-person" value={personId || listed[0]!.id} onChange={(e) => setPersonId(e.target.value)} className="w-full">
                {listed.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            ) : (
              <input id="demo-person" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm" />
            )}
            <p className="text-xs text-muted">
              {listed.length ? 'Видимость зависит от человека: оператор видит себя, менеджер свою группу.' : people.length ? 'В справочнике нет сотрудников с этой ролью.' : 'Справочник пуст: сотрудников и группы создаёт администратор (раздел «Команда»).'}
            </p>
          </div>
          {people.length === 0 && onSeedDemo && (role === 'lead' || role === 'admin') && (
            <div className="space-y-2">
              <Button type="button" size="sm" disabled={seeding} onClick={() => { setSeeding(true); setSeedError(null); onSeedDemo().catch(setSeedError).finally(() => setSeeding(false)); }}>Создать демо-команду</Button>
              <ErrorNote error={seedError} />
            </div>
          )}
          <p className="text-xs text-muted">Входа в демо нет: роль только разделяет обязанности.</p>
          <Button type="submit" variant="primary" size="sm" disabled={seeding}>Применить</Button>
        </form>
      )}
    </div>
  );
}
