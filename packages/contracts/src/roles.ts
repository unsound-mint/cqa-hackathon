import { z } from 'zod';

/**
 * Demo roles. There is no login: the UI sends the picked role and name as headers and the API enforces what each
 * role may do and see. That separates responsibilities for the demo; it is not security (any client can send any role).
 * A request without a role is unrestricted: scripts, the exporter and the stability runner call the API that way.
 */
export const RoleSchema = z.enum(['operator', 'reviewer', 'lead']);
export type Role = z.infer<typeof RoleSchema>;

export const ROLE_HEADER = 'x-cqa-role';
/** Display name of the acting person, URI-encoded (header values are Latin-1). For an operator it is also the identity that scopes what they see. */
export const ACTOR_HEADER = 'x-cqa-actor';

export type Actor = { role: Role; name: string };

export const ROLE_LABELS: Record<Role, string> = { operator: 'Оператор', reviewer: 'Проверяющий', lead: 'Руководитель' };

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
  | 'import';

const PERMISSIONS: Record<Role, readonly Permission[]> = {
  operator: ['appeal'],
  reviewer: ['review', 'decide', 'correct', 'evaluate'],
  lead: ['review', 'decide', 'correct', 'evaluate', 'editChecklist', 'assign', 'import'],
};

/** `actor` undefined = unrestricted (no role sent). */
export function can(actor: Actor | undefined, permission: Permission): boolean {
  return !actor || PERMISSIONS[actor.role].includes(permission);
}

/** Operators see only the dialogs assigned to them; reviewers and leads see everything. */
export function canSee(actor: Actor | undefined, conversation: { operatorId?: string | null }): boolean {
  return !actor || actor.role !== 'operator' || (!!conversation.operatorId && conversation.operatorId === actor.name);
}

export function parseActor(role: string | undefined, name: string | undefined): Actor | undefined {
  const r = RoleSchema.safeParse(role);
  if (!r.success) return undefined;
  let decoded = '';
  try {
    decoded = decodeURIComponent(name ?? '').trim();
  } catch {
    decoded = '';
  }
  return { role: r.data, name: decoded.slice(0, 80) };
}
