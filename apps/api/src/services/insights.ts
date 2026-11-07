import type { AgentImprovements } from '@cqa/contracts';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { checklistVersions } from '../db/schema.js';
import { getChecklist } from './checklists.js';
import { listEvaluations } from './evaluations.js';

/**
 * "Could the evaluated agent be built so this cannot fail?" For every criterion with an agentHint, counts the
 * completed evaluations where the final (post-review) result fell short: boolean false, or below the top tier.
 */
export function agentImprovements(db: Db, checklistVersionId?: string): AgentImprovements | undefined {
  const latest = db.select({ id: checklistVersions.id }).from(checklistVersions).orderBy(desc(checklistVersions.version)).limit(1).get();
  const checklist = getChecklist(db, checklistVersionId ?? latest?.id ?? '');
  if (!checklist) return undefined;
  const evals = listEvaluations(db).filter((e) => e.status === 'completed' && e.checklistVersionId === checklist.id);
  const items = checklist.criteria
    .filter((c) => c.agentHint)
    .map((c) => {
      let evaluated = 0;
      const failed: string[] = [];
      for (const e of evals) {
        const r = e.finalResults.find((x) => x.criterionId === c.id);
        if (!r || r.isNA) continue;
        evaluated++;
        const top = c.kind === 'discrete-scale' ? Math.max(...(c.allowedValues as number[])) : true;
        if (r.value !== top) failed.push(e.conversationId);
      }
      return { criterionId: c.id, title: c.title, agentHint: c.agentHint!, ruleCheckable: Boolean(c.detector), evaluated, shortfalls: failed.length, conversationIds: failed.slice(0, 50) };
    });
  return { checklistVersionId: checklist.id, evaluations: evals.length, items };
}
