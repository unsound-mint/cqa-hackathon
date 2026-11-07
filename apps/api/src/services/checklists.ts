import { ChecklistVersionSchema, SaveChecklistInputSchema, type ChecklistVersion, type SaveChecklistInput } from '@cqa/contracts';
import { asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { checklistVersions, evaluations } from '../db/schema.js';
import original from '../checklists/original.json';

/** Organizer's original eight-criterion checklist (control data; mirrors docs/RUBRIC.md). */
export const ORIGINAL_CHECKLIST = ChecklistVersionSchema.parse(original);

function toVersion(row: typeof checklistVersions.$inferSelect): ChecklistVersion {
  return ChecklistVersionSchema.parse({ ...row, sections: row.sections ?? undefined });
}

/**
 * Inserts version 1 on an empty database. Version 1 is the canonical control data in checklists/original.json:
 * if the stored row is outdated AND nothing was evaluated with it yet, it is replaced; otherwise it is never edited.
 */
export function seedOriginalChecklist(db: Db): void {
  const c = ORIGINAL_CHECKLIST;
  const row = { id: c.id, version: c.version, title: c.title, sections: c.sections ?? null, criteria: c.criteria, createdAt: c.createdAt };
  const existing = db.select().from(checklistVersions).where(eq(checklistVersions.id, c.id)).get();
  if (!existing) {
    if (!db.select({ id: checklistVersions.id }).from(checklistVersions).limit(1).get()) db.insert(checklistVersions).values(row).run();
    return;
  }
  const outdated = JSON.stringify(toVersion(existing)) !== JSON.stringify(ChecklistVersionSchema.parse({ ...row, sections: row.sections ?? undefined }));
  const used = db.select({ id: evaluations.id }).from(evaluations).where(eq(evaluations.checklistVersionId, c.id)).limit(1).get();
  if (outdated && !used) db.update(checklistVersions).set(row).where(eq(checklistVersions.id, c.id)).run();
}

export function listChecklists(db: Db): ChecklistVersion[] {
  return db.select().from(checklistVersions).orderBy(asc(checklistVersions.version)).all().map(toVersion);
}

export function getChecklist(db: Db, id: string): ChecklistVersion | undefined {
  const row = db.select().from(checklistVersions).where(eq(checklistVersions.id, id)).get();
  return row ? toVersion(row) : undefined;
}

/** Each save is a NEW version (max + 1) in one transaction; earlier versions are never modified. */
export function saveChecklistVersion(db: Db, input: SaveChecklistInput): ChecklistVersion {
  const data = SaveChecklistInputSchema.parse(input);
  return db.transaction((tx) => {
    const last = tx.select({ version: checklistVersions.version }).from(checklistVersions).orderBy(desc(checklistVersions.version)).limit(1).get();
    const version = (last?.version ?? 0) + 1;
    const row = { id: `checklist-v${version}`, version, title: data.title, sections: data.sections ?? null, criteria: data.criteria, createdAt: new Date().toISOString() };
    tx.insert(checklistVersions).values(row).run();
    return toVersion(row);
  });
}
