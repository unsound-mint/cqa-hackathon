import { deriveSeriousViolation, type Actor, type Appeal, type Evaluation } from '@cqa/contracts';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { tasks } from '../db/schema.js';
import { getChecklist } from './checklists.js';

/**
 * Blind cross-check: while a person has an OPEN cross-check task on a dialog, the read endpoints show them the AI's
 * initial results only, never the first reviewer's state, corrections or name. Output-only masking: nothing stored
 * changes, and the source conversation (hashed by the evaluation reuse cache) is not involved. A top manager is
 * exempt (they see everything anyway, and checking the QA team is their audit). See docs/ARCHITECTURE.md.
 */
export function blindConversationIds(db: Db, actor: Actor | undefined): ReadonlySet<string> {
  if (!actor?.id || actor.role === 'lead') return new Set();
  const rows = db.select({ c: tasks.conversationId }).from(tasks).where(and(eq(tasks.assigneeId, actor.id), eq(tasks.kind, 'crosscheck'), eq(tasks.status, 'open'))).all();
  return new Set(rows.map((r) => r.c));
}

/** The evaluation as the AI left it: final = original, flag derived from the original results. */
export function blindEvaluation(db: Db, e: Evaluation): Evaluation {
  const checklist = getChecklist(db, e.checklistVersionId);
  return { ...e, finalResults: e.originalResults, finalTotal: e.originalTotal, seriousViolation: checklist ? deriveSeriousViolation(checklist.criteria, e.originalResults) : e.seriousViolation };
}

/** Pending appeals are the operator's; corrections and decisions carry the reviewer's values and name. */
export const shownWhenBlind = (a: Appeal): boolean => a.kind !== 'correction' && a.status === 'pending';
