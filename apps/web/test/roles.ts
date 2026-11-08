import type { Role } from '@cqa/contracts';
import { setIdentity } from '../src/lib/identity';

/** Test helpers for the demo roles. The identity store falls back to memory outside a browser. */
/** A directory whose person ids are the operators' names, matching the name-only identities of `asRole`. */
export const DIRECTORY = { teams: [], people: [{ id: 'Алина', name: 'Алина', role: 'operator' as const, teamId: null }, { id: 'Тимур', name: 'Тимур', role: 'operator' as const, teamId: null }] };

export const asRole = (role: Role, name?: string) => setIdentity({ role, name: name ?? (role === 'operator' ? 'Алина' : role === 'reviewer' ? 'Мария' : 'Игорь') });

/** The same bundle with every dialog assigned to one operator (the plain fixture has no operator identity). */
export const withOperator = <B extends { conversations: object[] }>(bundle: B, name = 'Алина'): B => ({ ...bundle, conversations: bundle.conversations.map((c) => ({ ...c, operatorId: name })) });
