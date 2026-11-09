import type { Evaluation } from './domain.js';

/** Input is in creation order, as returned by listEvaluations. Failed attempts never replace valid scores. */
export function evaluationMaps(evaluations: readonly Evaluation[]) {
  const attempts = new Map<string, Evaluation>();
  const successful = new Map<string, Evaluation>();
  for (const e of evaluations) {
    attempts.set(e.conversationId, e);
    if (e.status === 'completed') successful.set(e.conversationId, e);
  }
  const preferred = new Map(attempts);
  for (const [id, e] of successful) preferred.set(id, e);
  return { attempts, successful, preferred };
}
