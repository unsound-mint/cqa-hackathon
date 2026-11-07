import { CriterionValueSchema, computeTotal, type ChecklistVersion, type Conversation } from '@cqa/contracts';
import { LABEL_COLUMNS, toCsv, type HumanLabel } from '@cqa/evaluation';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { humanLabelHistory, humanLabels } from '../db/schema.js';

export class LabelError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404,
  ) {
    super(message);
  }
}

export const LabelInputSchema = z.object({
  value: CriterionValueSchema.nullable(),
  isNA: z.boolean(),
  evidence: z.array(z.number().int().nonnegative()).default([]),
  inspectedRange: z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }).nullable().default(null),
  rationale: z.string().default(''),
  uncertainty: z.string().default(''),
  reviewer: z.string().default(''),
  adjudicated: z.boolean().default(false),
});
export type LabelInput = z.infer<typeof LabelInputSchema>;

function toLabel(r: typeof humanLabels.$inferSelect): HumanLabel {
  return {
    conversationId: r.conversationId,
    criterionId: r.criterionId,
    value: r.isNA ? null : (r.value as HumanLabel['value']),
    isNA: r.isNA,
    evidence: r.evidence,
    inspectedRange: r.inspectedFrom !== null && r.inspectedTo !== null ? { from: r.inspectedFrom, to: r.inspectedTo } : undefined,
    rationale: r.rationale,
    uncertainty: r.uncertainty,
    reviewer: r.reviewer,
    adjudicated: r.adjudicated,
  };
}

export const listLabels = (db: Db, conversationId?: string): HumanLabel[] =>
  (conversationId ? db.select().from(humanLabels).where(eq(humanLabels.conversationId, conversationId)) : db.select().from(humanLabels))
    .orderBy(asc(humanLabels.conversationId), asc(humanLabels.criterionId))
    .all()
    .map(toLabel);

/** Validates against the checklist and the transcript, writes the current label and an immutable history row. */
export function saveLabel(db: Db, checklist: ChecklistVersion, conversation: Conversation, criterionId: string, input: LabelInput): HumanLabel {
  const criterion = checklist.criteria.find((c) => c.id === criterionId);
  if (!criterion) throw new LabelError(`unknown criterion ${criterionId}`, 404);
  if (input.isNA) {
    if (!criterion.allowNA) throw new LabelError(`N/A is not permitted for criterion ${criterionId}`, 400);
    if (input.value !== null) throw new LabelError('N/A and a value are mutually exclusive', 400);
  } else if (input.value === null || !criterion.allowedValues.includes(input.value)) {
    throw new LabelError(`value must be one of ${JSON.stringify(criterion.allowedValues)}`, 400);
  }
  const last = conversation.transcript.length - 1;
  if (input.evidence.some((i) => i > last)) throw new LabelError(`evidence index outside 0..${last}`, 400);
  const r = input.inspectedRange;
  if (r && (r.from > r.to || r.to > last)) throw new LabelError(`inspected range must be inside 0..${last}`, 400);

  const now = new Date().toISOString();
  const row = {
    conversationId: conversation.id,
    criterionId,
    value: input.isNA ? null : input.value,
    isNA: input.isNA,
    evidence: [...new Set(input.evidence)].sort((a, b) => a - b),
    inspectedFrom: r?.from ?? null,
    inspectedTo: r?.to ?? null,
    rationale: input.rationale,
    uncertainty: input.uncertainty,
    reviewer: input.reviewer,
    adjudicated: input.adjudicated,
    updatedAt: now,
  };
  db.transaction((tx) => {
    tx.insert(humanLabels).values(row).onConflictDoUpdate({ target: [humanLabels.conversationId, humanLabels.criterionId], set: row }).run();
    tx.insert(humanLabelHistory).values({ conversationId: conversation.id, criterionId, action: 'save', snapshot: row, at: now }).run();
  });
  return toLabel(row);
}

export function clearLabel(db: Db, conversationId: string, criterionId: string): void {
  db.transaction((tx) => {
    const cur = tx.select().from(humanLabels).where(and(eq(humanLabels.conversationId, conversationId), eq(humanLabels.criterionId, criterionId))).get();
    if (!cur) return;
    tx.delete(humanLabels).where(and(eq(humanLabels.conversationId, conversationId), eq(humanLabels.criterionId, criterionId))).run();
    tx.insert(humanLabelHistory).values({ conversationId, criterionId, action: 'clear', snapshot: cur, at: new Date().toISOString() }).run();
  });
}

export type LabelProgress = { conversationId: string; labeled: number; total: number; humanTotal: number | null };

/** Per conversation: how many criteria are answered, and (once complete) the total those answers give. */
export function labelProgress(db: Db, checklist: ChecklistVersion): LabelProgress[] {
  const by = new Map<string, HumanLabel[]>();
  for (const l of listLabels(db)) by.set(l.conversationId, [...(by.get(l.conversationId) ?? []), l]);
  return [...by].map(([conversationId, ls]) => {
    const complete = checklist.criteria.every((c) => ls.some((l) => l.criterionId === c.id));
    let humanTotal: number | null = null;
    if (complete) {
      try {
        humanTotal = computeTotal(checklist.criteria, ls.map((l) => ({ criterionId: l.criterionId, value: l.value, isNA: l.isNA, explanation: '', evidence: [] })));
      } catch {
        humanTotal = null;
      }
    }
    return { conversationId, labeled: ls.length, total: checklist.criteria.length, humanTotal };
  });
}

export function labelsCsv(db: Db, conversations: Conversation[]): string {
  const meta = new Map(conversations.map((c) => [c.id, c]));
  const rows = listLabels(db).map((l) => [
    l.conversationId, meta.get(l.conversationId)?.language ?? '', meta.get(l.conversationId)?.channel ?? '', l.criterionId,
    l.isNA ? '' : String(l.value), l.isNA ? 'yes' : '', '', l.evidence.join(';'),
    l.inspectedRange ? `${l.inspectedRange.from}-${l.inspectedRange.to}` : '', l.rationale, l.uncertainty, l.reviewer, l.adjudicated ? 'yes' : '',
  ]);
  return toCsv([[...LABEL_COLUMNS], ...rows]);
}
