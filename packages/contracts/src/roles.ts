import { z } from 'zod';

/**
 * Demo roles. There is no login: the UI sends the picked person as headers and the API enforces what that role may
 * do and see. That separates responsibilities for the demo; it is not security (any client can send any role).
 * A request without a role is unrestricted: scripts, the exporter and the stability runner call the API that way.
 *
 * operator: own dialogs. reviewer (QA): the review work. manager: the team they lead. lead (top manager): everything,
 * including checking the QA team. admin: people, teams, import; sees all data but does not grade (separation of duties).
 */
export const RoleSchema = z.enum(['operator', 'reviewer', 'manager', 'lead', 'admin']);
export type Role = z.infer<typeof RoleSchema>;

export const ROLE_HEADER = 'x-cqa-role';
/** Display name of the acting person, URI-encoded (header values are Latin-1). */
export const ACTOR_HEADER = 'x-cqa-actor';
/** The person's id from the directory. Scopes an operator to themselves and a manager to their team. */
export const PERSON_HEADER = 'x-cqa-person';

export type Actor = { role: Role; name: string; id?: string };

export const ROLE_LABELS: Record<Role, string> = { operator: 'Оператор', reviewer: 'Проверяющий', manager: 'Менеджер группы', lead: 'Топ-менеджер', admin: 'Администратор' };

export type Permission =
  /** Move a dialog between new / in review / reviewed. */
  | 'review'
  /** Decide a pending appeal. */
  | 'decide'
  /** Change a criterion directly. */
  | 'correct'
  /** Dispute one's own grade. */
  | 'appeal'
  /** Save a new checklist version. */
  | 'editChecklist'
  /** Start or repeat an evaluation. */
  | 'evaluate'
  /** Assign dialogs to operators. */
  | 'assign'
  | 'import'
  /** People and teams. */
  | 'manageTeams'
  /** Write coaching comments on an operator's work. */
  | 'comment'
  /** Tag a result with an error category and its origin. */
  | 'tag'
  /** Hand work to QA persons (manually or by load). */
  | 'task'
  /** Re-grade a dialog blind: a second QA, or a top manager checking the QA team. */
  | 'crosscheck'
  /** Read the audit log and the suspicious-activity monitor. */
  | 'audit'
  /** Add events (a training, a policy change) to the timeline. */
  | 'timeline'
  /** Error categories used for tags. */
  | 'editTaxonomy';

const PERMISSIONS: Record<Role, readonly Permission[]> = {
  operator: ['appeal'],
  reviewer: ['review', 'decide', 'correct', 'evaluate', 'comment', 'tag', 'crosscheck'],
  manager: ['comment'],
  lead: ['review', 'decide', 'correct', 'evaluate', 'editChecklist', 'assign', 'import', 'manageTeams', 'comment', 'tag', 'task', 'crosscheck', 'audit', 'timeline', 'editTaxonomy'],
  admin: ['assign', 'import', 'manageTeams', 'audit', 'editTaxonomy'],
};

/** `actor` undefined = unrestricted (no role sent). */
export function can(actor: Actor | undefined, permission: Permission): boolean {
  return !actor || PERMISSIONS[actor.role].includes(permission);
}

/** Operators whose dialogs are visible; `null` = everyone's. */
export type Scope = ReadonlySet<string> | null;

/**
 * Least privilege: an operator sees only themselves, a manager only the operators of the teams they lead, everyone
 * else all. The identity of an operator is their person id (the name when the picker has no directory yet).
 */
export function operatorScope(actor: Actor | undefined, people: readonly { id: string; role: Role; teamId: string | null }[], teams: readonly { id: string; managerId: string | null }[]): Scope {
  if (!actor) return null;
  if (actor.role === 'operator') return new Set([actor.id ?? actor.name]);
  if (actor.role === 'manager') {
    const mine = new Set(teams.filter((t) => t.managerId !== null && t.managerId === actor.id).map((t) => t.id));
    return new Set(people.filter((p) => p.role === 'operator' && p.teamId !== null && mine.has(p.teamId)).map((p) => p.id));
  }
  return null;
}

export const canSee = (scope: Scope, conversation: { operatorId?: string | null }): boolean => scope === null || (!!conversation.operatorId && scope.has(conversation.operatorId));

export function parseActor(role: string | undefined, name: string | undefined, id?: string): Actor | undefined {
  const r = RoleSchema.safeParse(role);
  if (!r.success) return undefined;
  const decode = (v: string | undefined) => {
    try {
      return decodeURIComponent(v ?? '').trim();
    } catch {
      return '';
    }
  };
  const personId = decode(id).slice(0, 80);
  return { role: r.data, name: decode(name).slice(0, 80), ...(personId ? { id: personId } : {}) };
}
