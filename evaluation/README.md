# Human labels and model comparison

Tooling for `docs/VALIDATION.md`. **Labels are written only by a human.** Nothing here pre-fills, guesses or edits a label; a blank cell is reported as incomplete.

## 1. Pick conversations and make a sheet
```
pnpm -s --filter @cqa/evaluation cli list                      # id, language, channel, message counts (no scores)
pnpm -s --filter @cqa/evaluation cli sheet --ids id1,id2,...    # blank rows: one per conversation x criterion
```
The sheet goes to `evaluation/private/annotations.csv` (git-ignored; it will contain transcript quotes and judgments). `sheet` refuses to overwrite an existing file; add `--append` to add more conversations without touching existing rows. Open it in Excel/Sheets (`;` separators are fine).

The API must be running (`pnpm start` or `pnpm dev:api`); `--api URL` changes the address.

## 2. Fill it in
One row per conversation and criterion. Columns (`annotation-template.csv`):

| column | what to enter |
|---|---|
| `human_value` | boolean criteria: `yes`/`no` (also `да`/`нет`, `иә`/`жоқ`, `true`/`false`); scale criteria: the tier (04: 0, 5, 10, 15, 20; 06: 0, 4, 7, 10) |
| `human_na` | `yes` if N/A applies under the criterion's exact condition (only criteria 02, 03, 04, 07 allow it). Leave `human_value` empty then |
| `human_critical` | optional; for criterion 08 you may put the flag here instead of `human_value` |
| `evidence_message_indices` | zero-based message indices, `4;6` |
| `inspected_range` | for an absence claim, the inclusive range you checked, `3-11` |
| `rationale`, `uncertainty` | short text; say when you are unsure |
| `reviewer`, `adjudicated` | who labeled; `yes` once a disagreement was settled |

Indices are the original, unfiltered message positions (the `index` shown in the app). Score the operator only; bot and system messages are context.

## 3. Compare with the model
After conversations were evaluated through the app/API:
```
pnpm -s --filter @cqa/evaluation cli compare --out evaluation/private/report.md --text
```
Options: `--checklist ID` (default: the version with most evaluations), `--final` (compare reviewer-corrected results instead of the initial output), `--high-weight N` (default 15), `--json`, `--text` (adds the human and model reasons; **private**, keep it under `evaluation/private/`).

The report shows: coverage (incomplete labels, conversations without a prediction, failed evaluations); per-criterion exact agreement, mean tier error and N/A confusion; agreement by decision source (rule / hybrid / model), model confidence, language and channel; total-score MAE and bias; **points lost per criterion** (how much the total would change if that one criterion were corrected, using the same scorer as the app); false/missed N/A; serious-violation sensitivity and precision; evidence validity; and the disagreements ordered by that impact.

Totals are computed only for fully labeled conversations. Failed model outputs show up as "Evaluation failed". The "Run" section shows model, effort, prompt version, mean tokens and latency from each evaluation's provenance. Add `--price-in USD --price-out USD` (per million tokens; Haiku 5.5 is 0.10 and 0.50 for prompts up to 100K tokens) for a mean cost per evaluation.

## Safe to commit
This README, the template, the code and tests (fictional data only), and aggregate reports without transcript text. Never commit `evaluation/private/`.
