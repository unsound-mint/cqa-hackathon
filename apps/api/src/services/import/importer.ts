import { eq } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { conversations } from '../../db/schema.js';
import { parseDataset } from './dataset.js';

export class ImportError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export type ImportDeps = {
  /** Full signed URL from the environment. Server-only; never logged, returned or put in error text. */
  baseUrl: string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
};

export const GROUP_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** The configured URL carries a group_id; the requested group always wins. */
export function urlForGroup(baseUrl: string, groupId: string): string {
  const u = new URL(baseUrl);
  u.searchParams.set('group_id', groupId);
  return u.toString();
}

async function fetchJson(url: string, deps: ImportDeps): Promise<unknown> {
  const doFetch = deps.fetch ?? fetch;
  const retries = deps.retries ?? 3;
  let lastStatus = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, (deps.retryDelayMs ?? 500) * 2 ** (attempt - 1)));
    try {
      const res = await doFetch(url, { signal: AbortSignal.timeout(deps.timeoutMs ?? 30_000) });
      lastStatus = res.status;
      if (res.ok) return await res.json();
      if (res.status < 500 && res.status !== 429) break; // 4xx other than 429 will not heal on retry
    } catch {
      lastStatus = 0; // network error/timeout/bad JSON: retry; details deliberately dropped (may embed the URL)
    }
  }
  throw new ImportError(`dataset provider request failed (status ${lastStatus || 'network error'})`, 502);
}

export type ImportResult = {
  groupId: string;
  total: number;
  imported: number;
  failed: { recordIndex: number; conversationId?: string; reason: string }[];
};

/** Idempotent for unchanged input. Conflicting content is rejected atomically to preserve evidence sources. */
export async function importDataset(db: Db, groupId: string, deps: ImportDeps): Promise<ImportResult> {
  if (!GROUP_ID_PATTERN.test(groupId)) throw new ImportError('invalid groupId', 400);
  if (!deps.baseUrl) throw new ImportError('DATASET_IMPORT_URL is not configured on the server', 503);

  const json = await fetchJson(urlForGroup(deps.baseUrl, groupId), deps);
  let parsed;
  try {
    parsed = parseDataset(json, groupId);
  } catch (e) {
    throw new ImportError(e instanceof Error ? e.message : 'unreadable dataset', 502);
  }

  const now = new Date().toISOString();
  db.transaction((tx) => {
    for (const c of parsed.conversations) {
      // Evidence and in-flight jobs refer to this immutable source. Changed inputs need a new id.
      const existing = tx.select().from(conversations).where(eq(conversations.id, c.id)).get();
      if (existing && (existing.datasetGroupId !== c.datasetGroupId || existing.language !== c.language ||
          existing.channel !== c.channel || existing.audioUrl !== c.audioUrl ||
          JSON.stringify(existing.transcript) !== JSON.stringify(c.transcript))) {
        throw new ImportError('conversation content conflicts with an existing immutable source; import changed input under a new conversation id', 409);
      }
      const row = { id: c.id, datasetGroupId: c.datasetGroupId, language: c.language, channel: c.channel, audioUrl: c.audioUrl, transcript: c.transcript, importedAt: now };
      tx.insert(conversations).values(row).onConflictDoUpdate({ target: conversations.id, set: row }).run();
    }
  });
  return { groupId, total: parsed.total, imported: parsed.conversations.length, failed: parsed.failed };
}
