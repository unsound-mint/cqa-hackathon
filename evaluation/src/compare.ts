import { computeTotal, findEvidenceProblems, type ChecklistVersion, type Conversation, type Criterion, type CriterionResult, type Evaluation } from '@cqa/contracts';
import type { HumanLabel } from './labels.js';

export type CompareInput = {
  checklist: ChecklistVersion;
  labels: HumanLabel[];
  blanks: { conversationId: string; criterionId: string }[];
  conversations: Conversation[];
  /** Evaluations of any checklist version; only those of `checklist` are used. */
  evaluations: Evaluation[];
  /** Compare reviewer-corrected results instead of the initial output. Default: initial output. */
  useFinal?: boolean;
  /** Weight at or above which a disagreement counts as a high-weight failure. */
  highWeight?: number;
  /** USD per million tokens; when set, the report estimates cost per evaluation. */
  pricePerMTok?: { input: number; output: number };
};

type Tally = { n: number; agree: number };
const tally = (): Tally => ({ n: 0, agree: 0 });
const bump = (t: Tally, ok: boolean) => { t.n++; if (ok) t.agree++; };
const rate = (t: Tally) => (t.n ? t.agree / t.n : null);

export type Disagreement = {
  conversationId: string;
  criterionId: string;
  human: string;
  model: string;
  source: string;
  confidence: string;
  weight: number;
  /** Points of the 0-100 total that would change if this one criterion were corrected. null = conversation not fully labeled. */
  impact: number | null;
  humanRationale: string;
  modelExplanation: string;
};

export type Report = {
  checklistVersionId: string;
  useFinal: boolean;
  coverage: {
    labeledConversations: number;
    fullyLabeled: number;
    incomplete: { conversationId: string; missing: string[] }[];
    noPrediction: string[];
    failedEvaluation: string[];
    unknownConversation: string[];
  };
  criteria: {
    id: string;
    title: string;
    weight: number;
    n: number;
    agreement: number | null;
    meanAbsTierError: number | null;
    na: { both: number; humanOnly: number; modelOnly: number; neither: number };
    bySource: Record<string, { n: number; agreement: number | null }>;
  }[];
  totals: { n: number; mae: number | null; bias: number | null; perConversation: { conversationId: string; human: number | null; model: number | null; absError: number | null }[]; problems: string[] };
  impactByCriterion: { criterionId: string; totalImpact: number; disagreements: number }[];
  highWeightFailures: number;
  naErrors: { falseNA: number; missedNA: number };
  seriousViolation: { tp: number; fp: number; fn: number; tn: number; sensitivity: number | null; precision: number | null };
  evidenceValidity: { checked: number; valid: number; rate: number | null };
  byLanguage: Record<string, { n: number; agreement: number | null }>;
  byChannel: Record<string, { n: number; agreement: number | null }>;
  byConfidence: Record<string, { n: number; agreement: number | null }>;
  disagreements: Disagreement[];
  /** Model, effort, prompt version, tokens and latency of the compared evaluations (cost needs `pricePerMTok`). */
  run: RunStats;
};

export type RunStats = {
  evaluations: number;
  models: string[];
  efforts: string[];
  promptVersions: string[];
  /** Evaluations that called a model and recorded usage; rule/reuse-only ones are excluded from the means. */
  withUsage: number;
  meanInputTokens: number | null;
  meanOutputTokens: number | null;
  meanLatencyMs: number | null;
  meanCostUsd: number | null;
};

const show = (r: { value: unknown; isNA: boolean }) => (r.isNA ? 'N/A' : String(r.value));
const same = (h: HumanLabel, m: CriterionResult) => (h.isNA || m.isNA ? h.isNA && m.isNA : h.value === m.value);

function toResult(h: HumanLabel): CriterionResult {
  return { criterionId: h.criterionId, value: h.isNA ? null : h.value, isNA: h.isNA, explanation: h.rationale, evidence: [] };
}

export function compare(input: CompareInput): Report {
  const { checklist, labels, blanks, conversations } = input;
  const highWeight = input.highWeight ?? 15;
  const convById = new Map(conversations.map((c) => [c.id, c]));
  const byConv = new Map<string, Map<string, HumanLabel>>();
  for (const l of labels) (byConv.get(l.conversationId) ?? byConv.set(l.conversationId, new Map()).get(l.conversationId)!).set(l.criterionId, l);
  for (const b of blanks) if (!byConv.has(b.conversationId)) byConv.set(b.conversationId, new Map());

  const coverage: Report['coverage'] = { labeledConversations: byConv.size, fullyLabeled: 0, incomplete: [], noPrediction: [], failedEvaluation: [], unknownConversation: [] };
  const criteria = new Map<string, Criterion>(checklist.criteria.map((c) => [c.id, c]));
  const crit = new Map(checklist.criteria.map((c) => [c.id, { tally: tally(), absErr: [] as number[], na: { both: 0, humanOnly: 0, modelOnly: 0, neither: 0 }, bySource: new Map<string, Tally>() }]));
  const byLanguage = new Map<string, Tally>(), byChannel = new Map<string, Tally>(), byConfidence = new Map<string, Tally>();
  const disagreements: Disagreement[] = [];
  const perConversation: Report['totals']['perConversation'] = [];
  const totalsProblems: string[] = [];
  const serious = { tp: 0, fp: 0, fn: 0, tn: 0 };
  const evidence = { checked: 0, valid: 0 };
  const used: Evaluation[] = [];
  let falseNA = 0, missedNA = 0, highWeightFailures = 0;
  const getT = (m: Map<string, Tally>, k: string) => m.get(k) ?? m.set(k, tally()).get(k)!;

  for (const [conversationId, humans] of byConv) {
    const conversation = convById.get(conversationId);
    if (!conversation) { coverage.unknownConversation.push(conversationId); continue; }
    const missing = checklist.criteria.filter((c) => !humans.has(c.id)).map((c) => c.id);
    if (missing.length) coverage.incomplete.push({ conversationId, missing });

    const mine = input.evaluations.filter((e) => e.conversationId === conversationId && e.checklistVersionId === checklist.id);
    const evaluation = [...mine].reverse().find((e) => e.status === 'completed');
    if (evaluation) used.push(evaluation);
    if (!evaluation) { (mine.length ? coverage.failedEvaluation : coverage.noPrediction).push(conversationId); continue; }
    const modelResults = input.useFinal ? evaluation.finalResults : evaluation.originalResults;
    const modelBy = new Map(modelResults.map((r) => [r.criterionId, r]));

    const rows: { h: HumanLabel; m: CriterionResult; c: Criterion; ok: boolean }[] = [];
    for (const h of humans.values()) {
      const m = modelBy.get(h.criterionId);
      const c = criteria.get(h.criterionId);
      if (m && c) rows.push({ h, m, c, ok: same(h, m) });
    }

    const complete = missing.length === 0 && rows.length === checklist.criteria.length;
    let humanTotal: number | null = null, modelTotal: number | null = null;
    if (complete) {
      coverage.fullyLabeled++;
      try {
        humanTotal = computeTotal(checklist.criteria, [...humans.values()].map(toResult));
        modelTotal = computeTotal(checklist.criteria, modelResults);
        perConversation.push({ conversationId, human: humanTotal, model: modelTotal, absError: humanTotal !== null && modelTotal !== null ? Math.abs(humanTotal - modelTotal) : null });
      } catch (e) {
        totalsProblems.push(`${conversationId}: ${e instanceof Error ? e.message : 'total could not be computed'}`);
      }
    }

    for (const { h, m, c, ok } of rows) {
      const s = crit.get(c.id)!;
      bump(s.tally, ok);
      bump(getT(s.bySource, m.source ?? 'unknown'), ok);
      bump(getT(byLanguage, conversation.language), ok);
      bump(getT(byChannel, conversation.channel), ok);
      bump(getT(byConfidence, m.confidence ?? 'none'), ok);
      if (h.isNA && m.isNA) s.na.both++; else if (h.isNA) { s.na.humanOnly++; missedNA++; } else if (m.isNA) { s.na.modelOnly++; falseNA++; } else s.na.neither++;
      if (c.kind === 'discrete-scale' && !h.isNA && !m.isNA) s.absErr.push(Math.abs((h.value as number) - (m.value as number)));
      if (c.criticalFlag) {
        const hp = h.value === true, mp = m.value === true;
        if (hp && mp) serious.tp++; else if (!hp && mp) serious.fp++; else if (hp && !mp) serious.fn++; else serious.tn++;
      }
      const problems = findEvidenceProblems(conversation, [m]);
      if (m.evidence.length || m.checkedRange) { evidence.checked++; if (problems.length === 0) evidence.valid++; }

      if (!ok) {
        if (c.weight >= highWeight) highWeightFailures++;
        let impact: number | null = null;
        if (complete && modelTotal !== null) {
          try {
            const swapped = computeTotal(checklist.criteria, modelResults.map((r) => (r.criterionId === c.id ? toResult(h) : r)));
            impact = swapped === null ? null : Math.round(Math.abs(swapped - modelTotal) * 100) / 100;
          } catch { impact = null; }
        }
        disagreements.push({ conversationId, criterionId: c.id, human: show(h), model: show(m), source: m.source ?? 'unknown', confidence: m.confidence ?? 'none', weight: c.weight, impact, humanRationale: h.rationale, modelExplanation: m.explanation });
      }
    }
  }

  disagreements.sort((a, b) => (b.impact ?? -1) - (a.impact ?? -1) || b.weight - a.weight);
  const errs = perConversation.map((p) => p.absError).filter((x): x is number => x !== null);
  const diffs = perConversation.filter((p) => p.human !== null && p.model !== null).map((p) => p.model! - p.human!);
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
  const group = (m: Map<string, Tally>) => Object.fromEntries([...m].map(([k, t]) => [k, { n: t.n, agreement: rate(t) }]));

  const impactBy = new Map<string, { totalImpact: number; disagreements: number }>();
  for (const d of disagreements) {
    const e = impactBy.get(d.criterionId) ?? impactBy.set(d.criterionId, { totalImpact: 0, disagreements: 0 }).get(d.criterionId)!;
    e.totalImpact = Math.round((e.totalImpact + (d.impact ?? 0)) * 100) / 100;
    e.disagreements++;
  }

  return {
    checklistVersionId: checklist.id,
    useFinal: input.useFinal ?? false,
    coverage,
    criteria: checklist.criteria.map((c) => {
      const s = crit.get(c.id)!;
      return { id: c.id, title: c.title, weight: c.weight, n: s.tally.n, agreement: rate(s.tally), meanAbsTierError: mean(s.absErr), na: s.na, bySource: group(s.bySource) };
    }),
    totals: { n: perConversation.length, mae: mean(errs), bias: mean(diffs), perConversation, problems: totalsProblems },
    impactByCriterion: [...impactBy].map(([criterionId, v]) => ({ criterionId, ...v })).sort((a, b) => b.totalImpact - a.totalImpact),
    highWeightFailures,
    naErrors: { falseNA, missedNA },
    seriousViolation: { ...serious, sensitivity: serious.tp + serious.fn ? serious.tp / (serious.tp + serious.fn) : null, precision: serious.tp + serious.fp ? serious.tp / (serious.tp + serious.fp) : null },
    evidenceValidity: { ...evidence, rate: evidence.checked ? evidence.valid / evidence.checked : null },
    byLanguage: group(byLanguage),
    byChannel: group(byChannel),
    byConfidence: group(byConfidence),
    disagreements,
    run: runStats(used, input.pricePerMTok),
  };
}

function runStats(used: Evaluation[], price?: { input: number; output: number }): RunStats {
  const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  const timed = used.filter((e) => e.provenance?.usage);
  const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const inTok = timed.map((e) => e.provenance!.usage!.inputTokens + (e.provenance!.usage!.cacheReadTokens ?? 0) + (e.provenance!.usage!.cacheWriteTokens ?? 0));
  const outTok = timed.map((e) => e.provenance!.usage!.outputTokens);
  // Cache reads cost ~0.1x and writes ~1.25x of the input rate (documented Anthropic pricing).
  const cost = price && timed.length ? timed.map((e) => { const u = e.provenance!.usage!; return ((u.inputTokens + (u.cacheReadTokens ?? 0) * 0.1 + (u.cacheWriteTokens ?? 0) * 1.25) * price.input + u.outputTokens * price.output) / 1e6; }) : [];
  return {
    evaluations: used.length,
    models: uniq(used.map((e) => e.provenance?.model)),
    efforts: uniq(used.map((e) => e.provenance?.effort)),
    promptVersions: uniq(used.map((e) => e.provenance?.promptVersion)),
    withUsage: timed.length,
    meanInputTokens: mean(inTok),
    meanOutputTokens: mean(outTok),
    meanLatencyMs: mean(timed.map((e) => e.provenance!.latencyMs ?? 0)),
    meanCostUsd: cost.length ? Math.round((cost.reduce((a, b) => a + b, 0) / cost.length) * 1e5) / 1e5 : null,
  };
}
