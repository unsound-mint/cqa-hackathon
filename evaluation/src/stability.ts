import type { ChecklistVersion, CriterionResult, Evaluation } from '@cqa/contracts';

export type CriterionStability = {
  id: string;
  title: string;
  /** Conversations with at least two independent decisions for this criterion. */
  n: number;
  /** Of those, conversations where the decisions disagreed. */
  unstable: number;
  flipRate: number | null;
  bySource: Record<string, { n: number; unstable: number }>;
};

export type StabilityReport = {
  checklistVersionId: string;
  conversations: number;
  runsPerConversation: { min: number; max: number } | null;
  criteria: CriterionStability[];
  /** Range (max - min) of the initial total across runs. */
  totalRange: { mean: number | null; max: number | null; unstableConversations: number };
};

const key = (r: CriterionResult) => (r.isNA ? 'N/A' : JSON.stringify(r.value));

/**
 * How much the same conversation's result moves between independent runs (Haiku 5.5 takes no temperature, so
 * model-decided criteria can vary). Results copied from an earlier run (`reusedFrom`) are not independent and are
 * skipped, which is why repeats must be started with `fresh: true`. Rule-decided criteria must show 0 here.
 */
export function stability(evaluations: Evaluation[], checklist: ChecklistVersion): StabilityReport {
  const byConv = new Map<string, Evaluation[]>();
  for (const e of evaluations) {
    if (e.status !== 'completed' || e.checklistVersionId !== checklist.id) continue;
    (byConv.get(e.conversationId) ?? byConv.set(e.conversationId, []).get(e.conversationId)!).push(e);
  }
  const repeated = [...byConv].filter(([, runs]) => runs.length >= 2);

  const crit = new Map(checklist.criteria.map((c) => [c.id, { n: 0, unstable: 0, bySource: new Map<string, { n: number; unstable: number }>() }]));
  const ranges: number[] = [];
  for (const [, runs] of repeated) {
    for (const c of checklist.criteria) {
      const results = runs.map((e) => e.originalResults.find((r) => r.criterionId === c.id)).filter((r): r is CriterionResult => !!r && !r.reusedFrom);
      if (results.length < 2) continue;
      const differs = new Set(results.map(key)).size > 1;
      const s = crit.get(c.id)!;
      s.n++;
      if (differs) s.unstable++;
      const src = results[0]!.source ?? 'unknown';
      const b = s.bySource.get(src) ?? s.bySource.set(src, { n: 0, unstable: 0 }).get(src)!;
      b.n++;
      if (differs) b.unstable++;
    }
    const totals = runs.map((e) => e.originalTotal).filter((t): t is number => t !== null);
    if (totals.length >= 2) ranges.push(Math.round((Math.max(...totals) - Math.min(...totals)) * 100) / 100);
  }

  const sizes = repeated.map(([, runs]) => runs.length);
  return {
    checklistVersionId: checklist.id,
    conversations: repeated.length,
    runsPerConversation: sizes.length ? { min: Math.min(...sizes), max: Math.max(...sizes) } : null,
    criteria: checklist.criteria.map((c) => {
      const s = crit.get(c.id)!;
      return { id: c.id, title: c.title, n: s.n, unstable: s.unstable, flipRate: s.n ? s.unstable / s.n : null, bySource: Object.fromEntries(s.bySource) };
    }),
    totalRange: {
      mean: ranges.length ? Math.round((ranges.reduce((a, b) => a + b, 0) / ranges.length) * 100) / 100 : null,
      max: ranges.length ? Math.max(...ranges) : null,
      unstableConversations: ranges.filter((r) => r > 0).length,
    },
  };
}

export function formatStability(r: StabilityReport): string {
  const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(0)}%`);
  const out = [`# Run-to-run stability (${r.checklistVersionId})`];
  if (!r.conversations) return out.concat('\nNo conversation has two completed runs yet. Start repeats with `rerun` (they must be fresh: reused results are not independent).').join('\n') + '\n';
  out.push(`\n- Conversations with repeats: ${r.conversations}; runs each: ${r.runsPerConversation!.min}-${r.runsPerConversation!.max}`);
  out.push(`- Total score range across runs: mean ${r.totalRange.mean ?? 'n/a'}, max ${r.totalRange.max ?? 'n/a'}; conversations whose total moved: ${r.totalRange.unstableConversations}`);
  out.push(`\n| id | criterion | n | flipped | flip rate | by source (flipped/n) |\n|---|---|---|---|---|---|`);
  for (const c of r.criteria) out.push(`| ${c.id} | ${c.title} | ${c.n} | ${c.unstable} | ${pct(c.flipRate)} | ${Object.entries(c.bySource).map(([s, v]) => `${s} ${v.unstable}/${v.n}`).join('; ') || '-'} |`);
  out.push('\nA rule-decided criterion that flips is a bug. Model-decided criteria that flip are candidates for a narrower question or a detector.');
  return out.join('\n') + '\n';
}
