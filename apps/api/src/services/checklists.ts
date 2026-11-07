import { ChecklistVersionSchema, SaveChecklistInputSchema, type ChecklistVersion, type SaveChecklistInput } from '@cqa/contracts';
import { asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { checklistVersions } from '../db/schema.js';
import original from '../checklists/original.json';

/** Organizer's original eight-criterion checklist (control data; mirrors docs/RUBRIC.md). */
export const ORIGINAL_CHECKLIST = ChecklistVersionSchema.parse(original);

function toVersion(row: typeof checklistVersions.$inferSelect): ChecklistVersion {
  return ChecklistVersionSchema.parse({ ...row, sections: row.sections ?? undefined });
}

/** Inserts version 1 on an empty database. Never edits existing rows. */
export function seedOriginalChecklist(db: Db): void {
  const any = db.select({ id: checklistVersions.id }).from(checklistVersions).limit(1).get();
  if (any) return;
  const c = ORIGINAL_CHECKLIST;
  db.insert(checklistVersions).values({ id: c.id, version: c.version, title: c.title, sections: c.sections ?? null, criteria: c.criteria, createdAt: c.createdAt }).run();
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
