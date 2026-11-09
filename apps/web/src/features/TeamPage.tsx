import { ROLE_LABELS, RoleSchema, type ChecklistVersion, type Conversation, type Directory, type Person, type Role, type Team, type TaxonomyItem } from '@cqa/contracts';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/error-note';
import { Select } from '@/components/ui/field';

type Props = {
  directory: Directory;
  taxonomy: TaxonomyItem[];
  conversations: Conversation[];
  checklists: ChecklistVersion[];
  onSavePerson: (p: Person) => Promise<void>;
  onSaveTeam: (t: Team) => Promise<void>;
  onSeedDemo: () => Promise<void>;
  onAddCategory: (label: string, criterionId?: string) => Promise<void>;
};

const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const Card = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <div className="space-y-3 rounded-card border border-line bg-surface p-4 shadow-card">
    <div><h2 className="text-base font-semibold leading-6">{title}</h2>{hint && <p className="max-w-prose text-xs text-muted">{hint}</p>}</div>
    {children}
  </div>
);
const field = 'h-8 rounded-full border border-transparent bg-fill px-3 text-sm placeholder:text-muted';

/** People, teams and the error categories. The organizer data has none of them; the admin creates them (or fills a fictional demo organisation). */
export function TeamPage({ directory, taxonomy, conversations, checklists, onSavePerson, onSaveTeam, onSeedDemo, onAddCategory }: Props) {
  const [error, setError] = useState<unknown>(null);
  const guard = async (f: () => Promise<void>) => {
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e);
    }
  };
  const [person, setPerson] = useState<{ name: string; role: Role; teamId: string }>({ name: '', role: 'operator', teamId: '' });
  const [team, setTeam] = useState({ name: '', managerId: '' });
  const [note, setNote] = useState<string | null>(null);
  const [editP, setEditP] = useState<Person | null>(null);
  const [editT, setEditT] = useState<Team | null>(null);
  const saved = (text: string) => {
    setNote(text);
    window.setTimeout(() => setNote((cur) => (cur === text ? null : cur)), 4000);
  };
  const [cat, setCat] = useState({ label: '', criterionId: '' });
  const criteria = [...new Map(checklists.flatMap((c) => c.criteria).map((c) => [c.id, c])).values()];
  const managers = directory.people.filter((p) => p.role === 'manager');
  const empty = directory.people.length === 0;
  const count = (id: string) => conversations.filter((c) => c.operatorId === id).length;

  return (
    <section aria-label="Команда" className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-4 overflow-auto p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold leading-8">Команда</h1>
        <p className="max-w-prose text-sm text-muted">Сотрудники и группы. Менеджер видит только операторов своей группы, оператор — только себя. В данных организаторов сотрудников нет, их заводят здесь.</p>
      </div>
      <ErrorNote error={error} />
      <p role="status" className="min-h-0 text-sm text-accent empty:hidden">{note}</p>
      {empty && (
        <div className="rounded-card border border-line bg-surface p-4 text-sm">
          <p>Справочник пуст. Можно добавить сотрудников вручную или создать вымышленную демонстрационную команду: две группы, менеджеры, проверяющие, 8 операторов, а диалоги без оператора распределятся между ними. Это попадёт в журнал как демо-данные.</p>
          <Button className="mt-3" variant="primary" size="sm" onClick={() => void guard(onSeedDemo)}>Создать демонстрационную команду</Button>
        </div>
      )}
      <Card title="Группы">
        <ul className="space-y-2 text-sm">{directory.teams.map((t) => <li key={t.id}>{editT?.id === t.id ? (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void guard(async () => { await onSaveTeam({ ...editT, name: editT.name.trim() }); setEditT(null); saved(`Группа «${editT.name.trim()}» сохранена`); }); }}>
            <input aria-label="Название группы" required value={editT.name} onChange={(e) => setEditT({ ...editT, name: e.target.value })} className={field} />
            <Select aria-label="Менеджер группы" value={editT.managerId ?? ''} onChange={(e) => setEditT({ ...editT, managerId: e.target.value || null })} className="h-8 w-auto rounded-full border-transparent bg-fill pl-3 pr-8 text-sm"><option value="">Без менеджера</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
            <Button type="submit" size="sm" variant="primary">Сохранить</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditT(null)}>Отмена</Button>
          </form>
        ) : (
          <span className="flex flex-wrap items-center gap-x-2"><span className="font-medium">{t.name}</span> <span className="text-muted">менеджер: {directory.people.find((p) => p.id === t.managerId)?.name ?? 'не назначен'}, операторов: {directory.people.filter((p) => p.teamId === t.id).length}</span><Button type="button" size="sm" variant="ghost" aria-label={`Изменить группу ${t.name}`} onClick={() => setEditT(t)}>Изменить</Button></span>
        )}</li>)}{directory.teams.length === 0 && <li className="text-muted">Групп пока нет.</li>}</ul>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void guard(async () => { await onSaveTeam({ id: uid('team'), name: team.name.trim(), managerId: team.managerId || null }); setTeam({ name: '', managerId: '' }); }); }}>
          <input aria-label="Название группы" required value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} placeholder="Новая группа" className={field} />
          <Select aria-label="Менеджер группы" value={team.managerId} onChange={(e) => setTeam({ ...team, managerId: e.target.value })} className="h-8 w-auto rounded-full border-transparent bg-fill pl-3 pr-8 text-sm"><option value="">Без менеджера</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
          <Button type="submit" size="sm">Добавить группу</Button>
        </form>
      </Card>
      <Card title="Сотрудники">
        <div className="overflow-x-auto"><table className="w-full min-w-[30rem] text-sm"><caption className="sr-only">Сотрудники</caption><thead className="text-xs text-muted shadow-[0_1px_0_var(--c-line)]"><tr className="h-8 text-left"><th scope="col" className="pr-3 font-medium">Имя</th><th scope="col" className="pr-3 font-medium">Роль</th><th scope="col" className="pr-3 font-medium">Группа</th><th scope="col" className="text-right font-medium">Диалогов</th></tr></thead><tbody className="divide-y divide-line">
          {directory.people.map((p) => editP?.id === p.id ? (
            <tr key={p.id} className="h-12">
              <th scope="row" className="py-1 pr-3 text-left font-medium"><input aria-label="Имя сотрудника" required value={editP.name} onChange={(e) => setEditP({ ...editP, name: e.target.value })} className={field} /></th>
              <td className="py-1 pr-3"><Select aria-label="Роль сотрудника" value={editP.role} onChange={(e) => { const role = RoleSchema.parse(e.target.value); setEditP({ ...editP, role, teamId: role === 'operator' ? editP.teamId : null }); }} className="h-8 w-auto rounded-full border-transparent bg-fill pl-3 pr-8 text-sm">{RoleSchema.options.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select></td>
              <td className="py-1 pr-3">{editP.role === 'operator' ? <Select aria-label="Группа сотрудника" value={editP.teamId ?? ''} onChange={(e) => setEditP({ ...editP, teamId: e.target.value || null })} className="h-8 w-auto rounded-full border-transparent bg-fill pl-3 pr-8 text-sm"><option value="">—</option>{directory.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select> : <span className="text-muted">—</span>}</td>
              <td className="py-1 text-right"><span className="inline-flex gap-2"><Button type="button" size="sm" variant="primary" disabled={!editP.name.trim()} onClick={() => void guard(async () => { await onSavePerson({ ...editP, name: editP.name.trim() }); setEditP(null); saved(`Сотрудник «${editP.name.trim()}» сохранён`); })}>Сохранить</Button><Button type="button" size="sm" variant="ghost" onClick={() => setEditP(null)}>Отмена</Button></span></td>
            </tr>
          ) : (
            <tr key={p.id} className="h-10"><th scope="row" className="py-2 pr-3 text-left font-medium">{p.name}</th><td className="pr-3">{ROLE_LABELS[p.role]}</td><td className="pr-3">{p.role === 'operator' ? (
              <Select aria-label={`Группа: ${p.name}`} value={p.teamId ?? ''} onChange={(e) => void guard(async () => { await onSavePerson({ ...p, teamId: e.target.value || null }); saved(`${p.name}: ${e.target.value ? `переведён в группу «${directory.teams.find((t) => t.id === e.target.value)?.name ?? ''}»` : 'снят с группы'}`); })} className="h-8 w-auto rounded-full border-transparent bg-fill pl-3 pr-8 text-sm"><option value="">—</option>{directory.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
            ) : <span className="text-muted">—</span>}</td><td className="whitespace-nowrap text-right tabular-nums">{p.role === 'operator' ? <span className="mr-3">{count(p.id)}</span> : null}<Button type="button" size="sm" variant="ghost" aria-label={`Изменить: ${p.name}`} onClick={() => setEditP(p)}>Изменить</Button></td></tr>
          ))}
        </tbody></table></div>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void guard(async () => { await onSavePerson({ id: uid(person.role === 'operator' ? 'op' : 'p'), name: person.name.trim(), role: person.role, teamId: person.role === 'operator' && person.teamId ? person.teamId : null }); setPerson({ ...person, name: '' }); }); }}>
          <input aria-label="Имя сотрудника" required value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} placeholder="Новый сотрудник" className={field} />
          <Select aria-label="Роль сотрудника" value={person.role} onChange={(e) => setPerson({ ...person, role: RoleSchema.parse(e.target.value) })} className="h-8 w-auto rounded-full border-transparent bg-fill pl-3 pr-8 text-sm">{RoleSchema.options.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select>
          {person.role === 'operator' && <Select aria-label="Группа нового сотрудника" value={person.teamId} onChange={(e) => setPerson({ ...person, teamId: e.target.value })} className="h-8 w-auto rounded-full border-transparent bg-fill pl-3 pr-8 text-sm"><option value="">Без группы</option>{directory.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}
          <Button type="submit" size="sm">Добавить сотрудника</Button>
        </form>
      </Card>
      <Card title="Категории ошибок" hint="Проверяющие отмечают ими причины потерянных баллов (вместе с тем, где корень проблемы). Категория может относиться к критерию, например подкатегории внутри критерия «Корректность».">
        <ul className="flex flex-wrap gap-2 text-sm">{taxonomy.map((t) => <li key={t.id} className="rounded-full bg-fill px-3 py-1">{t.label}{t.criterionId && <span className="ml-1 text-xs text-muted">критерий {t.criterionId}</span>}</li>)}{taxonomy.length === 0 && <li className="text-muted">Категорий пока нет.</li>}</ul>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void guard(async () => { await onAddCategory(cat.label.trim(), cat.criterionId || undefined); setCat({ label: '', criterionId: '' }); }); }}>
          <input aria-label="Название категории" required value={cat.label} onChange={(e) => setCat({ ...cat, label: e.target.value })} placeholder="Новая категория" className={field} />
          <Select aria-label="Критерий категории" value={cat.criterionId} onChange={(e) => setCat({ ...cat, criterionId: e.target.value })} className="h-8 w-auto max-w-64 rounded-full border-transparent bg-fill pl-3 pr-8 text-sm"><option value="">Для любого критерия</option>{criteria.map((c) => <option key={c.id} value={c.id}>{c.id} {c.title}</option>)}</Select>
          <Button type="submit" size="sm">Добавить категорию</Button>
        </form>
      </Card>
    </section>
  );
}
