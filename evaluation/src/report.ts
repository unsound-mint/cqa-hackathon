import type { Report } from './compare.js';

const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(0)}%`);
const num = (x: number | null) => (x === null ? 'n/a' : String(x));
const table = (head: string[], rows: string[][]) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const groupRows = (g: Report['byLanguage']) => Object.entries(g).map(([k, v]) => [k, String(v.n), pct(v.agreement)]);

/**
 * Markdown report. Free text (human rationale, model explanation) is included only with `includeText`,
 * because it can quote transcripts: write such reports under evaluation/private/.
 */
export function formatReport(r: Report, opts: { includeText?: boolean; maxDisagreements?: number } = {}): string {
  const out: string[] = [];
  out.push(`# Evaluation comparison (${r.checklistVersionId}, ${r.useFinal ? 'reviewer-corrected' : 'initial'} results)`);
  const c = r.coverage;
  out.push(`\n## Coverage\n- Labeled conversations: ${c.labeledConversations}; fully labeled: ${c.fullyLabeled}`);
  if (c.incomplete.length) out.push(`- INCOMPLETE labels (excluded from totals): ${c.incomplete.map((i) => `${i.conversationId} missing ${i.missing.join(',')}`).join('; ')}`);
  if (c.noPrediction.length) out.push(`- No evaluation yet: ${c.noPrediction.join(', ')}`);
  if (c.failedEvaluation.length) out.push(`- Evaluation failed (counts as a parse/validation failure): ${c.failedEvaluation.join(', ')}`);
  if (c.unknownConversation.length) out.push(`- Not in the database: ${c.unknownConversation.join(', ')}`);

  out.push(`\n## Per criterion\n` + table(['id', 'criterion', 'weight', 'n', 'exact agreement', 'mean tier error', 'by source (n, agreement)'],
    r.criteria.map((x) => [x.id, x.title, String(x.weight), String(x.n), pct(x.agreement), num(x.meanAbsTierError), Object.entries(x.bySource).map(([s, v]) => `${s} ${v.n}, ${pct(v.agreement)}`).join('; ') || '-'])));

  out.push(`\n## Total score (0-100)\n- Conversations compared: ${r.totals.n}; MAE: ${num(r.totals.mae)}; bias (model - human): ${num(r.totals.bias)}`);
  for (const p of r.totals.problems) out.push(`- PROBLEM ${p}`);
  out.push(`\n## Where the score is lost (points that change if one criterion were corrected)\n` + (r.impactByCriterion.length
    ? table(['criterion', 'disagreements', 'total impact (points)'], r.impactByCriterion.map((x) => [x.criterionId, String(x.disagreements), String(x.totalImpact)])) : '- no disagreements'));
  out.push(`\n## Risk indicators\n- High-weight failures: ${r.highWeightFailures}\n- False N/A (model said N/A, human did not): ${r.naErrors.falseNA}; missed N/A: ${r.naErrors.missedNA}\n- Serious violation: TP ${r.seriousViolation.tp}, FP ${r.seriousViolation.fp}, FN ${r.seriousViolation.fn}, TN ${r.seriousViolation.tn}; sensitivity ${pct(r.seriousViolation.sensitivity)}, precision ${pct(r.seriousViolation.precision)}\n- Evidence validity: ${r.evidenceValidity.valid}/${r.evidenceValidity.checked} (${pct(r.evidenceValidity.rate)})`);
  out.push(`\n## N/A confusion per criterion\n` + table(['id', 'both N/A', 'human only', 'model only', 'neither'], r.criteria.filter((x) => x.na.both + x.na.humanOnly + x.na.modelOnly > 0).map((x) => [x.id, String(x.na.both), String(x.na.humanOnly), String(x.na.modelOnly), String(x.na.neither)])));
  out.push(`\n## Agreement by language\n` + table(['language', 'n', 'agreement'], groupRows(r.byLanguage)));
  out.push(`\n## Agreement by channel\n` + table(['channel', 'n', 'agreement'], groupRows(r.byChannel)));
  out.push(`\n## Agreement by model confidence\n` + table(['confidence', 'n', 'agreement'], groupRows(r.byConfidence)));

  const max = opts.maxDisagreements ?? 25;
  const head = ['conversation', 'criterion', 'human', 'model', 'source', 'confidence', 'weight', 'impact'];
  const rows = r.disagreements.slice(0, max).map((d) => [d.conversationId, d.criterionId, d.human, d.model, d.source, d.confidence, String(d.weight), num(d.impact)]);
  out.push(`\n## Disagreements (largest impact first, ${Math.min(max, r.disagreements.length)} of ${r.disagreements.length})\n` + (rows.length ? table(head, rows) : '- none'));
  if (opts.includeText && r.disagreements.length) {
    out.push('\n### Reasons (private: may quote transcripts)');
    for (const d of r.disagreements.slice(0, max)) out.push(`- ${d.conversationId} / ${d.criterionId}: human "${d.humanRationale || '-'}" vs model "${d.modelExplanation || '-'}"`);
  }
  return out.join('\n') + '\n';
}
