import { DirectorySchema, PersonSchema, TeamSchema, operatorScope, type Actor, type Directory, type Person, type Scope, type Team } from '@cqa/contracts';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { conversations, evaluations, operatorAssignments, people, teams } from '../db/schema.js';
import { ApiError } from './errors.js';
import { toEvaluation } from './evaluations.js';
import { logEvent } from './events.js';
import { notifyCritical } from './notifications.js';

export function getDirectory(db: Db): Directory {
  return DirectorySchema.parse({
    people: db.select().from(people).all().sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    teams: db.select().from(teams).all().sort((a, b) => a.name.localeCompare(b.name, 'ru')),
  });
}

/** What the caller may see: an operator themselves, a manager their team, everyone else all (null). */
export function scopeOf(db: Db, actor: Actor | undefined): Scope {
  if (!actor || (actor.role !== 'operator' && actor.role !== 'manager')) return null;
  const d = getDirectory(db);
  return operatorScope(actor, d.people, d.teams);
}

export function savePerson(db: Db, input: Person, actor?: Actor): Person {
  const p = PersonSchema.parse(input);
  db.transaction((tx) => {
    if (p.teamId && !tx.select().from(teams).where(eq(teams.id, p.teamId)).get()) throw new ApiError('team not found', 400);
    tx.insert(people).values(p).onConflictDoUpdate({ target: people.id, set: p }).run();
    logEvent(tx, actor, { type: 'directory.changed', summary: `Сотрудник «${p.name}» сохранён`, data: { personId: p.id, role: p.role, teamId: p.teamId } });
  });
  return p;
}

export function saveTeam(db: Db, input: Team, actor?: Actor): Team {
  const t = TeamSchema.parse(input);
  db.transaction((tx) => {
    if (t.managerId && !tx.select().from(people).where(eq(people.id, t.managerId)).get()) throw new ApiError('manager not found', 400);
    tx.insert(teams).values(t).onConflictDoUpdate({ target: teams.id, set: t }).run();
    logEvent(tx, actor, { type: 'directory.changed', summary: `Группа «${t.name}» сохранена`, data: { teamId: t.id, managerId: t.managerId } });
  });
  return t;
}

export const personById = (db: Db, id: string): Person | undefined => {
  const r = db.select().from(people).where(eq(people.id, id)).get();
  return r ? PersonSchema.parse(r) : undefined;
};

/** Operator and team manager of a dialog: who to tell when something critical happens on it. */
export function responsibleFor(db: Db, conversationId: string): { operatorId?: string; managerId?: string } {
  const operatorId = db.select().from(operatorAssignments).where(eq(operatorAssignments.conversationId, conversationId)).get()?.operator;
  const person = operatorId ? personById(db, operatorId) : undefined;
  const team = person?.teamId ? db.select().from(teams).where(eq(teams.id, person.teamId)).get() : undefined;
  return { ...(operatorId ? { operatorId } : {}), ...(team?.managerId ? { managerId: team.managerId } : {}) };
}

const FIRST = ['Алина', 'Тимур', 'Дана', 'Марат', 'Аружан', 'Ерлан', 'Камила', 'Нурлан', 'Айгерим', 'Данияр', 'Сабина', 'Руслан'];
const LAST = ['Ким', 'Сарсенов', 'Ахметова', 'Исаев', 'Оспанова', 'Волков', 'Ли', 'Байжанов', 'Петрова', 'Жумабаев', 'Смирнова', 'Омаров'];

/**
 * Fictional organisation for demos: the organizer data carries no teams or people. Two teams with a manager each,
 * four QA persons, a top manager, an admin, and operators; dialogs nobody has are spread over the operators in a
 * round robin. Marked in the audit log as demo data. Nothing here touches a grade.
 */
export function seedDemoOrg(db: Db, actor?: Actor): { people: number; assigned: number } {
  return db.transaction((tx) => {
    if (tx.select().from(people).limit(1).get()) throw new ApiError('the directory is not empty', 409);
    const mk = (id: string, name: string, role: Person['role'], teamId: string | null) => tx.insert(people).values({ id, name, role, teamId }).run();
    tx.insert(teams).values([{ id: 'team-a', name: 'Группа А', managerId: 'mgr-a' }, { id: 'team-b', name: 'Группа Б', managerId: 'mgr-b' }]).run();
    mk('mgr-a', 'Асель Нурпеисова', 'manager', null);
    mk('mgr-b', 'Виктор Лим', 'manager', null);
    mk('lead-1', 'Игорь Касымов', 'lead', null);
    mk('admin-1', 'Админ Системы', 'admin', null);
    ['Мария Левина', 'Сергей Аубакиров', 'Ольга Темирова', 'Булат Ержанов'].forEach((n, i) => mk(`qa-${i + 1}`, n, 'reviewer', null));
    const ops = FIRST.slice(0, 8).map((f, i) => ({ id: `op-${i + 1}`, name: `${f} ${LAST[i]}`, team: i % 2 === 0 ? 'team-a' : 'team-b' }));
    ops.forEach((o) => mk(o.id, o.name, 'operator', o.team));
    const free = tx.select({ id: conversations.id }).from(conversations).all().map((c) => c.id).filter((id) => !tx.select().from(operatorAssignments).where(eq(operatorAssignments.conversationId, id)).get());
    const at = new Date().toISOString();
    free.forEach((conversationId, i) => tx.insert(operatorAssignments).values({ conversationId, operator: ops[i % ops.length]!.id, assignedBy: 'демо', assignedAt: at }).run());
    // Dialogs evaluated before anyone was responsible for them: their critical alerts reach the new managers now.
    for (const { id } of tx.select({ id: conversations.id }).from(conversations).all()) {
      const latest = tx.select().from(evaluations).where(eq(evaluations.conversationId, id)).orderBy(desc(evaluations.createdAt), desc(evaluations.id)).get();
      if (latest) notifyCritical(db, toEvaluation(latest), { tx, once: true });
    }
    logEvent(tx, actor, { type: 'directory.changed', summary: `Создана демонстрационная команда (вымышленные сотрудники), диалогов распределено: ${free.length}`, data: { demo: true } });
    return { people: 4 + 4 + ops.length, assigned: free.length };
  });
}
