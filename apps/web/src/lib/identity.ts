import { ROLE_LABELS, RoleSchema, type Actor } from '@cqa/contracts';
import { useSyncExternalStore } from 'react';

/**
 * The demo identity: which role the person at the keyboard plays. There is no login; the API client sends it as
 * headers and the server (or the mock) enforces what that role may do and see. Kept per browser.
 * The first visit is the lead: every screen is there, so a first look sees checklist editing and appeals at once.
 */
const KEY = 'cqa-identity';
const DEFAULT: Actor = { role: 'lead', name: ROLE_LABELS.lead };

let memory: string | null = null; // used when storage is blocked
const listeners = new Set<() => void>();
const rawRead = () => {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return memory;
  }
};

let cache: { raw: string | null; value: Actor } = { raw: null, value: DEFAULT };
export function getIdentity(): Actor {
  const raw = rawRead();
  if (raw === cache.raw) return cache.value;
  let value = DEFAULT;
  try {
    const v = JSON.parse(raw ?? 'null') as { role?: unknown; name?: unknown } | null;
    const role = RoleSchema.safeParse(v?.role);
    if (role.success) value = { role: role.data, name: typeof v?.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 80) : ROLE_LABELS[role.data] };
  } catch {
    /* unreadable value: the default */
  }
  cache = { raw, value };
  return value;
}

export function setIdentity(next: Actor): void {
  const raw = JSON.stringify({ role: next.role, name: next.name.trim() || ROLE_LABELS[next.role] });
  memory = raw;
  try {
    window.localStorage.setItem(KEY, raw);
  } catch {
    /* kept in memory for this session */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useIdentity = (): Actor => useSyncExternalStore(subscribe, getIdentity, () => DEFAULT);
