import type { Role } from '@cqa/contracts';
import { setIdentity } from '../src/lib/identity';

/** Test helpers for the demo roles. The identity store falls back to memory outside a browser. */
export const asRole = (role: Role, name?: string) => setIdentity({ role, name: name ?? (role === 'operator' ? 'Алина' : role === 'reviewer' ? 'Мария' : 'Игорь') });

/** The same bundle with every dialog assigned to one operator (the plain fixture has no operator identity). */
export const withOperator = <B extends { conversations: object[] }>(bundle: B, name = 'Алина'): B => ({ ...bundle, conversations: bundle.conversations.map((c) => ({ ...c, operatorId: name })) });
