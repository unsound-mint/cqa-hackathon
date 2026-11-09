# Measured cost and latency: 75-conversation run

On 8 November 2026, one stored job evaluated all **75 conversations: 70 chats and five voice transcripts**, across RU/KZ/EN. It produced **73 completed evaluations and two validation failures**. The completed work recorded **$0.23446** in token-priced cost, averaging **$0.00321 per completed conversation** (about 0.32 US cents).

These figures were recovered from existing evaluation provenance; no additional model calls were made to produce this report. The [aggregate JSON](measurements/2026-11-08-eval-v17.json) contains the counts, token totals, rates, timestamps and exact job identifier. It contains no transcript text, quotes, audio URLs or reference labels.

## Run scope

| Field | Value |
|---|---|
| Source | Local runtime `data/cqa.sqlite`, job `job-775230bf-cc74-409b-b4fb-7048b3e66bea` |
| Inputs | 65 DEV + 10 control; RU 39, KZ 19, EN 17 |
| Model / effort | `claude-haiku-5-5` / `medium`, Anthropic API |
| Prompt / evaluator | `eval-v17` / `operator-v3` |
| Checklist | `checklist-original-v1` |
| Started → last result stored | 2026-11-08 06:09:51.903 → 06:14:25.290 UTC |
| Observed time to store all 75 outcomes | 273.387 seconds (4 min 33 s) |
| Completed / failed | 73 / 2; 68 chats + all five calls completed |
| Completed evaluations with usage | 73 of 73 |
| Failed evaluations with usage | 0 of 2 |
| Reused criterion results | 0; deterministic rules still apply |

This is the application's concurrent evaluation job, not Anthropic's discounted Batch API. Selecting exactly its 75 stored evaluation IDs avoids mixing earlier runs, checklist demos or successful fallback results with the measured run. In particular, an older completed evaluation displayed after a newer failure is not counted as success here.

## Recorded tokens and cost

Prices are USD per million tokens, [verified against Anthropic](https://platform.claude.com/docs/en/models/haiku-5-5/overview) on 8 November 2026. These successful evaluations each recorded at most 47,176 combined input tokens across their requests; each individual request therefore falls in the up-to-100K prompt tier.

| Category | Recorded tokens | USD / million | Calculated USD |
|---|---:|---:|---:|
| Uncached input | 659,072 | 0.10 | 0.065907200 |
| Output | 285,021 | 0.50 | 0.142510500 |
| Cache read | 936,434 | 0.01 | 0.009364340 |
| Cache write (5 minutes) | 133,433 | 0.125 | 0.016679125 |
| **Total, 73 completed evaluations** | | | **0.234461165** |

Formula: `sum(tokens_in_category × USD_per_million_in_category) / 1,000,000`. Mean: `$0.234461165 / 73 = $0.0032117968` per completed evaluation. Cache reads and writes are priced separately, rather than charging all input at the uncached rate.

## Evaluation latency

Times below use the stored elapsed evaluation time for the same 73 completed evaluations, covering the evaluator's concurrent request slices and repair attempts.

| Metric | Seconds |
|---|---:|
| Mean | 10.50 |
| Median | 8.83 |
| p95 (nearest rank) | 27.33 |
| Minimum / maximum | 4.56 / 40.82 |

The observed 4 min 33 s is job start to last stored outcome, including the failed outcomes and concurrent processing. It is not the sum of per-evaluation times or a repeated performance benchmark.

## Accounting boundary

**This is measured token usage priced at published rates, not the complete provider bill.** Both failed evaluations lack persisted usage, so their spend is unknown and excluded from $0.23446. Successful-evaluation usage includes responses returned for schema repair, but usage lost inside provider-level retries is not guaranteed to be captured. Earlier diagnostics and other jobs are also outside this run. The current failure path stores an error but discards accumulated usage; complete spend accounting needs that implementation gap addressed.

The completion rate is 73/75 (97.33%). It measures valid evaluation production, not agreement with reference grades. No accuracy or human-reference claims are derived from these cost records.

## How the aggregates were checked

The source database was opened read-only in a consistent SQLite transaction. The job's `evaluation_ids` were resolved individually and checked against its exact set of 75 requested conversation IDs and checklist version. All 73 completed rows had the same model, effort and prompt version and nonnegative integer usage counters; their original criterion results contained no `reusedFrom` reference. The two failures had no usage counters. Independent SQL aggregation was checked against the published JSON, and decimal arithmetic was used for all costs.
