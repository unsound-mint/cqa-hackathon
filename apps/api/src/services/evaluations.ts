import { EvaluationSchema, type Evaluation } from '@cqa/contracts';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import type { DecisionFacts } from './evaluation/semantic/index.js';
import { evaluations } from '../db/schema.js';

export function toEvaluation(row: typeof evaluations.$inferSelect): Evaluation {
  const { createdAt: _c, error, provenance, ...rest } = row;
  return EvaluationSchema.parse({ ...rest, error: error ?? undefined, provenance: provenance ?? undefined });
}

/** Used by the evaluation job (issue #5). Final results start as a copy of the originals. */
export function insertEvaluation(db: Db, e: Evaluation, cacheContext?: string, decisionFacts?: DecisionFacts): void {
  db.insert(evaluations)
    .values({ ...EvaluationSchema.parse(e), cacheContext: cacheContext ?? null, decisionFacts: decisionFacts ?? null, provenance: e.provenance ?? null, error: e.error ?? null, createdAt: new Date().toISOString() })
    .run();
}

export function getEvaluation(db: Db, id: string): Evaluation | undefined {
  const row = db.select().from(evaluations).where(eq(evaluations.id, id)).get();
  return row ? toEvaluation(row) : undefined;
}

export function listEvaluations(db: Db, conversationId?: string): Evaluation[] {
  const q = db.select().from(evaluations);
  return (conversationId ? q.where(eq(evaluations.conversationId, conversationId)) : q).orderBy(asc(evaluations.createdAt), asc(evaluations.id)).all().map(toEvaluation);
}
