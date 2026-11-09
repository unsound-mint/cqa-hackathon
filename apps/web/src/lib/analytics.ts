import { evaluationMaps } from '@cqa/contracts';
import type { Appeal, AuditEvent, ChecklistVersion, Comment, Conversation, Crosscheck, Directory, Evaluation, Person, Tag, Task, TimelineEvent } from '@cqa/contracts';
import { earnedPoints, sameResult } from './present';
import { reviewOf } from './queue';

/**
 * Everything the analytics screens show, computed from lists the app already loaded (no endpoint). Pure functions, no
 * clock except where a `now` is passed. Small samples are never ranked or compared silently: every figure carries
 * its n and the minimum below which it is not presented as a result.
 */

export const MIN_N = 5;
const DAY = 86_400_000;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** The current evaluation of each dialog (the API lists evaluations in creation order). */
export function latestOf(evaluations: Evaluation[]): Map<string, Evaluation> {
  return evaluationMaps(evaluations).preferred;
}
const done = (e: Evaluation | undefined): e is Evaluation => e?.status === 'completed';
const total = (e: Evaluation) => (e.finalTotal === null ? [] : [e.finalTotal]);

export type Ctx = { conversations: Conversation[]; evaluations: Evaluation[]; checklists: ChecklistVersion[]; appeals: Appeal[]; directory: Directory };

// ---------- rankings ----------

export type RankRow = { id: string | null; name: string; teamName: string | null; n: number; dialogs: number; average: number | null; violations: number; rankable: boolean; rank: number | null };

/** Operators by average final score. Below `minN` evaluated dialogs a person is listed but not ranked: a leaderboard of 2-3 dialogs ranks noise. */
export function rankOperators(ctx: Ctx, minN = MIN_N): RankRow[] {
  const latest = latestOf(ctx.evaluations);
  const teamName = (p: Person) => ctx.directory.teams.find((t) => t.id === p.teamId)?.name ?? null;
  const rows: RankRow[] = ctx.directory.people
    .filter((p) => p.role === 'operator')
    .map((p) => {
      const mine = ctx.conversations.filter((c) => c.operatorId === p.id);
      const evals = mine.map((c) => latest.get(c.id)).filter(done);
      return { id: p.id, name: p.name, teamName: teamName(p), n: evals.length, dialogs: mine.length, average: mean(evals.flatMap(total)), violations: evals.filter((e) => e.seriousViolation).length, rankable: evals.length >= minN, rank: null };
    })
    .filter((r) => r.dialogs > 0);
  const ranked = rows.filter((r) => r.rankable).sort((a, b) => (b.average ?? 0) - (a.average ?? 0) || a.name.localeCompare(b.name, 'ru'));
  ranked.forEach((r, i) => (r.rank = i + 1));
  return [...ranked, ...rows.filter((r) => !r.rankable).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'ru'))];
}

export function rankTeams(ctx: Ctx, minN = MIN_N): RankRow[] {
  const latest = latestOf(ctx.evaluations);
  const rows: RankRow[] = ctx.directory.teams.map((t) => {
    const members = new Set(ctx.directory.people.filter((p) => p.teamId === t.id).map((p) => p.id));
    const mine = ctx.conversations.filter((c) => c.operatorId && members.has(c.operatorId));
    const evals = mine.map((c) => latest.get(c.id)).filter(done);
    return { id: t.id, name: t.name, teamName: null, n: evals.length, dialogs: mine.length, average: mean(evals.flatMap(total)), violations: evals.filter((e) => e.seriousViolation).length, rankable: evals.length >= minN, rank: null };
  }).filter((r) => r.dialogs > 0);
  const ranked = rows.filter((r) => r.rankable).sort((a, b) => (b.average ?? 0) - (a.average ?? 0));
  ranked.forEach((r, i) => (r.rank = i + 1));
  return [...ranked, ...rows.filter((r) => !r.rankable)];
}

// ---------- time series and training effect ----------

const dayOf = (iso: string) => iso.slice(0, 10);
/** Monday of the week of an ISO date (UTC), as YYYY-MM-DD. */
export function weekStart(iso: string): string {
  const d = new Date(`${dayOf(iso)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export type TrendPoint = { week: string; n: number; average: number | null };

/** Average final score per week of evaluation, for everyone or for a set of operators. The x axis is when the dialog was evaluated: the source gives no call dates. */
export function weeklyTrend(ctx: Ctx, operatorIds: ReadonlySet<string> | null = null): TrendPoint[] {
  const latest = latestOf(ctx.evaluations);
  const byWeek = new Map<string, number[]>();
  for (const c of ctx.conversations) {
    const e = latest.get(c.id);
    if (!done(e) || !e.createdAt || (operatorIds && !(c.operatorId && operatorIds.has(c.operatorId)))) continue;
    const w = weekStart(e.createdAt);
    byWeek.set(w, [...(byWeek.get(w) ?? []), ...total(e)]);
  }
  return [...byWeek].sort(([a], [b]) => a.localeCompare(b)).map(([week, xs]) => ({ week, n: xs.length, average: mean(xs) }));
}

export type Cell = { n: number; average: number | null };
export type TrainingEffect = {
  event: TimelineEvent;
  participants: { before: Cell; after: Cell };
  comparison: { before: Cell; after: Cell };
  /** Change of the participants minus change of the comparison cohort, in points; null without a comparison cohort or enough data. */
  effect: number | null;
  /** Change of the participants alone (no control for time). */
  participantChange: number | null;
  enough: boolean;
};

/** Difference-in-differences: did the trained group improve more than a similar group that was not trained? Needs `minN` evaluated dialogs in every cell. */
export function trainingEffect(event: TimelineEvent, ctx: Ctx, minN = MIN_N): TrainingEffect {
  const latest = latestOf(ctx.evaluations);
  const cell = (ids: string[], side: 'before' | 'after'): Cell => {
    const set = new Set(ids);
    const xs = ctx.conversations.flatMap((c) => {
      const e = latest.get(c.id);
      if (!done(e) || !e.createdAt || !c.operatorId || !set.has(c.operatorId)) return [];
      const after = dayOf(e.createdAt) >= event.date;
      return (side === 'after') === after ? total(e) : [];
    });
    return { n: xs.length, average: mean(xs) };
  };
  const participants = { before: cell(event.participantIds, 'before'), after: cell(event.participantIds, 'after') };
  const comparison = { before: cell(event.comparisonIds, 'before'), after: cell(event.comparisonIds, 'after') };
  const ok = (c: Cell) => c.n >= minN && c.average !== null;
  const pOk = ok(participants.before) && ok(participants.after);
  const cOk = ok(comparison.before) && ok(comparison.after);
  const participantChange = pOk ? participants.after.average! - participants.before.average! : null;
  const effect = pOk && cOk ? participantChange! - (comparison.after.average! - comparison.before.average!) : null;
  return { event, participants, comparison, effect, participantChange, enough: pOk && cOk };
}

// ---------- criteria, errors, unclear rules ----------

export type CriterionSignal = { criterionId: string; title: string; n: number; lostShare: number | null; changed: number; appeals: number; overturned: number; clarityRate: number; suspectUnclear: boolean };

/**
 * Where the grade is contested. A criterion that reviewers often change or whose appeals are often upheld for the
 * operator is more likely an unclear rule than a weak operator. Needs `minN` results before it points a finger.
 */
export function criterionSignals(ctx: Ctx, minN = MIN_N * 2): CriterionSignal[] {
  const latest = latestOf(ctx.evaluations);
  const evals = [...latest.values()].filter(done);
  const checklistOf = (e: Evaluation) => ctx.checklists.find((c) => c.id === e.checklistVersionId);
  const ids = new Set(evals.flatMap((e) => e.finalResults.map((r) => r.criterionId)));
  const evalIds = new Set(evals.map((e) => e.id));
  const disputes = ctx.appeals.filter((a) => a.kind !== 'correction' && evalIds.has(a.evaluationId));
  return [...ids].map((criterionId) => {
    let n = 0, changed = 0, earned = 0, possible = 0;
    let title = criterionId;
    for (const e of evals) {
      const r = e.finalResults.find((x) => x.criterionId === criterionId);
      if (!r) continue;
      const crit = checklistOf(e)?.criteria.find((c) => c.id === criterionId);
      if (crit) title = crit.title;
      n++;
      if (!sameResult(e.originalResults.find((x) => x.criterionId === criterionId), r)) changed++;
      const pts = earnedPoints(crit, r);
      if (crit && pts !== null && !r.isNA) {
        earned += pts;
        possible += crit.weight;
      }
    }
    const mine = disputes.filter((a) => a.criterionId === criterionId);
    const overturned = mine.filter((a) => a.status === 'overridden').length;
    const clarityRate = n ? (changed + overturned) / n : 0;
    return { criterionId, title, n, lostShare: possible > 0 ? 1 - earned / possible : null, changed, appeals: mine.length, overturned, clarityRate, suspectUnclear: n >= minN && clarityRate >= 0.25 };
  }).sort((a, b) => b.clarityRate - a.clarityRate || a.criterionId.localeCompare(b.criterionId));
}

export type ErrorStats = { total: number; byOrigin: Record<'operator' | 'process' | 'rule' | 'tool', number>; notOperatorShare: number | null; byLabel: { label: string; count: number }[]; byCriterion: { criterionId: string; count: number }[] };

export function errorStats(tags: Tag[]): ErrorStats {
  const byOrigin = { operator: 0, process: 0, rule: 0, tool: 0 };
  const labels = new Map<string, number>();
  const crit = new Map<string, number>();
  for (const t of tags) {
    byOrigin[t.origin]++;
    if (t.label) labels.set(t.label, (labels.get(t.label) ?? 0) + 1);
    if (t.criterionId) crit.set(t.criterionId, (crit.get(t.criterionId) ?? 0) + 1);
  }
  const desc = <K extends string>(m: Map<string, number>, key: K) => [...m].map(([k, count]) => ({ [key]: k, count }) as Record<K, string> & { count: number }).sort((a, b) => b.count - a.count);
  return { total: tags.length, byOrigin, notOperatorShare: tags.length ? 1 - byOrigin.operator / tags.length : null, byLabel: desc(labels, 'label'), byCriterion: desc(crit, 'criterionId') };
}

// ---------- QA work ----------

export type QaRow = { reviewerId: string; reviewer: string; reviewed: number; timed: number; medianMinutes: number | null; openTasks: number };
export type QaMetrics = { rows: QaRow[]; queueLength: number; backlogAgeDays: number | null; reviewedLast7Days: number; perDay: number; medianMinutes: number | null };

/**
 * Review time = from "in review" to "reviewed" by the same person on the same dialog, read from the event log (the
 * state alone has lost when it started). Reviews finished without being taken first have no duration and are not timed.
 */
export function qaMetrics(events: AuditEvent[], tasks: Task[], conversations: Conversation[], evaluations: Evaluation[], directory: Directory, now = Date.now()): QaMetrics {
  const asc = [...events].filter((e) => e.type === 'review.set').sort((a, b) => a.at.localeCompare(b.at));
  const started = new Map<string, number>();
  const per = new Map<string, { name: string; reviewed: number; minutes: number[] }>();
  const all: number[] = [];
  let last7 = 0;
  for (const e of asc) {
    const status = e.data?.status;
    const key = `${e.actorId ?? e.actorName}|${e.conversationId}`;
    const who = e.actorId ?? e.actorName; // two people may share a name; the id is the identity
    const row = per.get(who) ?? per.set(who, { name: e.actorName, reviewed: 0, minutes: [] }).get(who)!;
    if (status === 'in_review') started.set(key, Date.parse(e.at));
    else if (status === 'reviewed') {
      row.reviewed++;
      if (now - Date.parse(e.at) <= 7 * DAY) last7++;
      const s = started.get(key);
      if (s !== undefined) {
        const m = (Date.parse(e.at) - s) / 60_000;
        row.minutes.push(m);
        all.push(m);
        started.delete(key);
      }
    }
  }
  const latest = latestOf(evaluations);
  const open = conversations.filter((c) => done(latest.get(c.id)) && reviewOf(c, latest.get(c.id)).state !== 'reviewed');
  const oldest = open.map((c) => Date.parse(latest.get(c.id)?.createdAt ?? c.importedAt ?? '')).filter((t) => !Number.isNaN(t));
  const names = new Map(directory.people.map((p) => [p.id, p.name]));
  const load = new Map<string, number>();
  for (const t of tasks) if (t.status === 'open') load.set(t.assigneeId, (load.get(t.assigneeId) ?? 0) + 1);
  const reviewers = new Set([...per.keys(), ...load.keys()]);
  return {
    rows: [...reviewers].map((reviewer) => ({ reviewerId: reviewer, reviewer: names.get(reviewer) ?? per.get(reviewer)?.name ?? reviewer, reviewed: per.get(reviewer)?.reviewed ?? 0, timed: per.get(reviewer)?.minutes.length ?? 0, medianMinutes: median(per.get(reviewer)?.minutes ?? []), openTasks: load.get(reviewer) ?? 0 })).sort((a, b) => b.reviewed - a.reviewed || a.reviewer.localeCompare(b.reviewer, 'ru')),
    queueLength: open.length,
    backlogAgeDays: oldest.length ? Math.max(0, (now - Math.min(...oldest)) / DAY) : null,
    reviewedLast7Days: last7,
    perDay: last7 / 7,
    medianMinutes: median(all),
  };
}

export type AgreementRow = { reviewerId: string; reviewer: string; role: string; checks: number; results: number; agreeFirst: number; agreeAi: number };
export type CriterionAgreement = { criterionId: string; results: number; agreeFirst: number };

/**
 * A cross-check re-grades a dialog blind. Agreement = same answer as the result standing after the first review
 * (the AI plus that reviewer's corrections), and as the AI's own original answer. A lead's check is QA-of-QA.
 */
export function agreement(crosschecks: Crosscheck[], evaluations: Evaluation[]): { rows: AgreementRow[]; byCriterion: CriterionAgreement[] } {
  const byId = new Map(evaluations.map((e) => [e.id, e]));
  const rows = new Map<string, AgreementRow>();
  const crit = new Map<string, CriterionAgreement>();
  for (const c of crosschecks) {
    const e = byId.get(c.evaluationId);
    if (!e) continue;
    const who = c.reviewerId ?? c.reviewerName;
    const row = rows.get(who) ?? rows.set(who, { reviewerId: who, reviewer: c.reviewerName, role: c.reviewerRole, checks: 0, results: 0, agreeFirst: 0, agreeAi: 0 }).get(who)!;
    row.checks++;
    for (const r of c.results) {
      const same = (x: { value: unknown; isNA: boolean } | undefined) => !!x && x.isNA === r.isNA && x.value === r.value;
      const first = same(e.finalResults.find((x) => x.criterionId === r.criterionId));
      const ai = same(e.originalResults.find((x) => x.criterionId === r.criterionId));
      row.results++;
      if (first) row.agreeFirst++;
      if (ai) row.agreeAi++;
      const k = crit.get(r.criterionId) ?? crit.set(r.criterionId, { criterionId: r.criterionId, results: 0, agreeFirst: 0 }).get(r.criterionId)!;
      k.results++;
      if (first) k.agreeFirst++;
    }
  }
  return { rows: [...rows.values()].sort((a, b) => b.checks - a.checks), byCriterion: [...crit.values()].sort((a, b) => a.agreeFirst / a.results - b.agreeFirst / b.results) };
}

// ---------- suspicious activity ----------

export type Finding = { kind: 'rubber-stamp' | 'one-direction' | 'self-review'; actor: string; summary: string; at: string; conversationIds: string[] };

/**
 * Patterns worth a second look in the audit log. They are prompts for a human, not verdicts. Thresholds are
 * deliberately plain: 5 reviews in 2 minutes, 5 corrections in a row in the same direction, an appeal decided by the
 * person who had already changed that dialog.
 */
export function suspicious(events: AuditEvent[]): Finding[] {
  const asc = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const out: Finding[] = [];
  const by = (type: AuditEvent['type']) => asc.filter((e) => e.type === type);
  const actorOf = (e: AuditEvent) => e.actorId ?? e.actorName;

  // Rubber stamp: many "reviewed" in a couple of minutes.
  const reviewed = by('review.set').filter((e) => e.data?.status === 'reviewed');
  for (const name of new Set(reviewed.map(actorOf))) {
    const mine = reviewed.filter((e) => actorOf(e) === name);
    for (let i = 0; i + 4 < mine.length; i++) {
      if (Date.parse(mine[i + 4]!.at) - Date.parse(mine[i]!.at) > 120_000) continue;
      // The burst is the whole run inside the two minutes, not just the five that tripped the threshold.
      let end = i + 4;
      while (end + 1 < mine.length && Date.parse(mine[end + 1]!.at) - Date.parse(mine[i]!.at) <= 120_000) end++;
      const w = mine.slice(i, end + 1);
      out.push({ kind: 'rubber-stamp', actor: w[0]!.actorName, at: w[w.length - 1]!.at, summary: `${w.length} диалогов отмечены проверенными за ${Math.max(1, Math.round((Date.parse(w[w.length - 1]!.at) - Date.parse(w[0]!.at)) / 1000))} с`, conversationIds: w.map((e) => e.conversationId ?? '') });
      break;
    }
  }

  // One direction: corrections that all raise (or all lower) the answer.
  const fixes = by('result.corrected');
  for (const name of new Set(fixes.map(actorOf))) {
    const mine = fixes.filter((e) => actorOf(e) === name);
    const dirs = mine.map((e) => {
      const b = (e.data?.before as { value?: unknown } | undefined)?.value;
      const a = (e.data?.after as { value?: unknown } | undefined)?.value;
      if (typeof b === 'boolean' && typeof a === 'boolean') return a === b ? 0 : a ? 1 : -1;
      return typeof b === 'number' && typeof a === 'number' ? Math.sign(a - b) : 0;
    });
    for (const dir of [1, -1]) {
      const run = dirs.filter((d) => d !== 0);
      if (run.length >= 5 && run.every((d) => d === dir)) {
        out.push({ kind: 'one-direction', actor: mine[0]!.actorName, at: mine[mine.length - 1]!.at, summary: `Все ${run.length} исправлений ${dir > 0 ? 'повышают' : 'понижают'} оценку`, conversationIds: [...new Set(mine.map((e) => e.conversationId ?? ''))] });
        break;
      }
    }
  }

  // Self review: decided an appeal on a dialog the same person had already corrected.
  for (const d of by('appeal.decided')) {
    const earlier = fixes.some((f) => actorOf(f) === actorOf(d) && f.conversationId === d.conversationId && f.at < d.at && f.data?.viaAppeal === undefined);
    if (earlier) out.push({ kind: 'self-review', actor: d.actorName, at: d.at, summary: 'Решил апелляцию по диалогу, который сам исправлял', conversationIds: [d.conversationId ?? ''] });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

// ---------- critical follow-up ----------

export type FollowUpStage = 'unreviewed' | 'no_comment' | 'unacknowledged' | 'done';
export type FollowUp = { conversationId: string; stage: FollowUpStage };

/** A dialog with a serious violation is dealt with when it is reviewed, the operator got a comment and read it. */
export function followUp(conversations: Conversation[], evaluations: Evaluation[], comments: Comment[]): FollowUp[] {
  const latest = latestOf(evaluations);
  return conversations.flatMap((c) => {
    const e = latest.get(c.id);
    if (!done(e) || !e.seriousViolation) return [];
    const mine = comments.filter((x) => x.conversationId === c.id);
    const stage: FollowUpStage = reviewOf(c, e).state !== 'reviewed' ? 'unreviewed' : mine.length === 0 ? 'no_comment' : mine.some((x) => !x.ackedAt) ? 'unacknowledged' : 'done';
    return [{ conversationId: c.id, stage }];
  });
}

// ---------- clients: repeat contacts and ratings ----------

export type Fcr = { clients: number; contacts: number; repeated: number; rate: number | null };

/**
 * First contact resolution proxy: the share of dialogs after which the same client wrote again within `days`. Needs a
 * client id and a start time on the dialogs; the DEV set has neither, so the screen says so instead of guessing.
 */
export function fcr(conversations: Conversation[], days = 7): Fcr | null {
  const dated = conversations.filter((c) => c.clientId && c.startedAt);
  if (dated.length === 0) return null;
  const byClient = new Map<string, number[]>();
  for (const c of dated) byClient.set(c.clientId!, [...(byClient.get(c.clientId!) ?? []), Date.parse(c.startedAt!)]);
  let repeated = 0;
  for (const ts of byClient.values()) {
    ts.sort((a, b) => a - b);
    ts.forEach((t, i) => {
      if (ts[i + 1] !== undefined && ts[i + 1]! - t <= days * DAY) repeated++;
    });
  }
  return { clients: byClient.size, contacts: dated.length, repeated, rate: 1 - repeated / dated.length };
}

export type CsatStats = { n: number; average: number | null; correlation: number | null; criteria: { criterionId: string; title: string; low: number | null; high: number | null; gap: number | null }[] };

const pearson = (xs: number[], ys: number[]) => {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs)!;
  const my = mean(ys)!;
  const sx = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0));
  const sy = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0));
  return sx === 0 || sy === 0 ? null : xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0) / (sx * sy);
};

/**
 * Do our criteria say what clients feel? Correlation of the client's rating with the final score, and per criterion
 * the share of points earned when the rating was low (1-2) versus high (4-5): a criterion with no gap does not
 * discriminate, a large gap is one clients notice. Needs ratings in the data.
 */
export function csatStats(conversations: Conversation[], evaluations: Evaluation[], checklists: ChecklistVersion[]): CsatStats | null {
  const latest = latestOf(evaluations);
  const rated = conversations.filter((c) => c.csat != null && done(latest.get(c.id)));
  if (rated.length === 0) return null;
  const scores = rated.map((c) => latest.get(c.id)!.finalTotal ?? 0);
  const ratings = rated.map((c) => c.csat as number);
  const ids = new Set(rated.flatMap((c) => latest.get(c.id)!.finalResults.map((r) => r.criterionId)));
  const share = (group: Conversation[], criterionId: string) => {
    let earned = 0, possible = 0;
    for (const c of group) {
      const e = latest.get(c.id)!;
      const crit = checklists.find((k) => k.id === e.checklistVersionId)?.criteria.find((k) => k.id === criterionId);
      const r = e.finalResults.find((x) => x.criterionId === criterionId);
      const pts = r && !r.isNA ? earnedPoints(crit, r) : null;
      if (crit && pts !== null && crit.weight > 0) {
        earned += pts;
        possible += crit.weight;
      }
    }
    return possible > 0 ? earned / possible : null;
  };
  const low = rated.filter((c) => (c.csat as number) <= 2);
  const high = rated.filter((c) => (c.csat as number) >= 4);
  const titleOf = (id: string) => checklists.flatMap((k) => k.criteria).find((c) => c.id === id)?.title ?? id;
  return {
    n: rated.length,
    average: mean(ratings),
    correlation: pearson(scores, ratings),
    criteria: [...ids].map((criterionId) => {
      const l = share(low, criterionId);
      const h = share(high, criterionId);
      return { criterionId, title: titleOf(criterionId), low: l, high: h, gap: l !== null && h !== null ? h - l : null };
    }).sort((a, b) => (b.gap ?? -1) - (a.gap ?? -1)),
  };
}
