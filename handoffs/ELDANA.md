# Eldana + validation/research agent

## Ownership contract: what you decide vs what your agent does

**You personally decide:** all manual rubric labels, which transcript evidence supports each label, whether a discrepancy is a model mistake versus ambiguity, QA priorities and demo narrative. You must read the actual conversations before seeing the model's answer on calibration cases. Your economics background is relevant to evaluating the consultation outcome; it does not grant assumed access to broker policy or the organizers' true reference labels.

**Your agent executes:** formatting annotation sheets, rubric examples with fictional inputs, a scoring-comparison script, grouping disagreement categories, reproducible bug reports and a five-minute demonstration draft. It is **not** allowed to silently supply missing human labels, change your answers to agree with an LLM, or assert that your labels are the organizers' Ground Truth.

**Independent start condition:** the organizer's rubric PDF and appropriately shared local DEV conversations. Neither a GitHub scaffold nor a running application is necessary for the first ten labels. When the repo exists, put safe artifacts in `evaluation/`; store sensitive transcript content and annotations in ignored `evaluation/private/` and do not post private examples in public GitHub issues.

### Ordered validation issues

| Order | Priority | Outcome | Acceptance demonstration |
|---|---|---|---|
| E1 | P0 | Rubric decision guide and annotation template | Clear allowed values, N/A rules, source indices, uncertainty field |
| E2 | P0 | First 10 independent manual labels | Diverse RU/KZ/EN, multiple requests, identity, N/A, abrupt chat; no model grades seen first |
| E3 | P0 | Calibration with Denis | Disagreements adjudicated from rubric and logged as generalizable rules |
| E4 | P0 | 20–25 labeled examples + small holdout | Scores and evidence complete; uncertain cases preserved; private labels stored safely |
| E5 | P0 | Model comparison/error taxonomy | Per-criterion exact match, N/A confusion, weighted score MAE, critical flag metrics |
| E6 | P0 | UI acceptance tests and demo | Reproducible bugs, real versus mocked steps identified, timed five-minute sequence |

### How to label one conversation

1. Read the entire transcript, including what the client told the bot **before** the operator joined.
2. Mark the exact first operator reply and the requested outcomes. Score **operator behavior**; bot/system messages are context, not automatic credit.
3. For each of eight rubric criteria, select only an allowed answer/tier and whether N/A is permitted **under its exact condition**. Criterion 08 is a separate flag, not a penalty in the 100-point score.
4. Record evidence message **indices** (zero-based, unchanged by filtering), or a checked inclusive range for a missing action; write a short explanation and mark uncertainty.
5. Do not assume a financial assertion is correct without reliable policy; flag factual uncertainty for adjudication. Do not grade acoustic quality from transcripts.
6. Once the first ten are labeled, review disagreements with Denis; preserve your original answers in a separate history rather than silently overwriting them.

### Prioritize these failure cases

- Operator fails to answer a second substantive question even though replies are clear.
- Bot greets the client, but operator does not introduce themself.
- Verification is required but system confirmation comes **after** disclosure.
- Public informational question does not require identification (N/A versus No).
- Operator explicitly warns about a wait versus only apologizing afterward.
- Client leaves before operator can close, versus operator abruptly closes.
- Off-company paid offer, insult or confidential disclosure triggers serious-violation flag.
- Mixed Russian/Kazakh/English messages and real-call transcripts.

### Deliverable to Denis

A safe aggregate evaluation report: `n`, per-criterion confusion, total score MAE, evidence validity, false N/A, critical-error classification, representative generalizable failure patterns, and explicit uncertainty. Send private case IDs and detailed examples only via an authorized channel. Report improvements as hypotheses, not untested claims.

## Human: your exact steps
1. Accept the collaborator invite. Read the organizer's 3-page rubric and `docs/RUBRIC.md`, then skim 10 varied DEV conversations through the authorized local dataset. Do not rely on model scores first.
2. Ask your agent to prepare the annotation template, examples, test-case matrix and a simple comparison script. Use **Validation setup prompt** below. The agent may format and automate but must NOT decide human Ground Truth for you.
3. Personally label the original eight criteria for approximately 10 conversations, referring to transcript message indices. Note uncertainty explicitly. Discuss ambiguous cases with Denis to produce a consistent written rule.
4. Expand to 20–25 diverse conversations including RU/KZ/EN and voice if permitted. Keep sensitive transcripts and quotes in ignored local `evaluation/private/`; public repo may include safe schemas and aggregate metrics only.
5. Once Denis produces model predictions, run **Comparison prompt**. Identify high-impact disagreement cases and discuss fixes; do not secretly relabel your work to agree with the model.
6. Test the UI as a first-time reviewer, write reproducible bug issues, then own the five-minute demonstration script and rehearsal.

## Agent prompt 1 — validation setup

> You are Eldana's assistant for a brokerage conversation QA hackathon. Read AGENTS.md and the organizer rubric in `docs/RUBRIC.md`; stay within `evaluation/` and relevant validation docs. Your human owner Eldana makes every human evaluation decision. You may extract, format, explain, audit and compare, but must NOT create or pretend to create human Ground Truth labels yourself.
>
> Build `evaluation/annotation-template.csv` and a lightweight CLI validator/comparison tool (TypeScript or Python, whichever existing repo tooling favors) that accepts a manually filled human annotation file and model prediction file and reports per-criterion exact agreement, total score MAE, N/A confusion, serious-violation precision/recall, and evidence-reference validity. A row must track conversation ID, language, criterion ID, human score/NA, evidence indices, rationale, uncertainty, reviewer. Missing labels should be reported as incomplete, NEVER guessed or filled automatically.
>
> Write a concise guide to distinguishing No from N/A and consultation-quality from conversation clarity. Create a test matrix for eight criteria including partial answer, greeting by bot vs operator, verification timing, early closing, and off-platform paid offers. Do not incorporate exact per-conversation outcomes as hardcoded rules. Real dataset and any transcript quotes stay local/ignored; include fictional examples only in public files. Add unit tests for the comparison tool using fictional rows.
>
> Produce a scoped PR and identify the exact first 10 *types of cases* Eldana should manually select, without pre-labeling them. Report what is ready and what must be decided by the human.

## Agent prompt 2 — benchmark comparison and demo

> You are Eldana's agent, working with human-authorized local manual annotations and model outputs. Do not modify, infer or overwrite blank human labels. Run the validation script and produce an error report ordered by weighted potential scoring impact, with separate tabs/sections for RU, KZ and EN. Group recurring failure modes in language-independent terms, citing real example IDs only in private files. Distinguish labeling ambiguity from genuine model error. Suggest prompt/rule experiments to Denis, not direct edits to the evaluator. Then draft a realistic 5-minute demo sequence covering: select dialogue, criterion rationale and evidence jump, N/A and total, appeal and reviewer override, and UI checklist change applied to new data. State which steps are implemented versus mock versus unverified. Make a scoped PR containing only safe aggregate results, non-sensitive QA scripts and demo documentation.

## Human annotation guide
- Score what the operator did, using bot/system only as surrounding context.
- Use the rubric's exact allowed tiers and N/A conditions. Do not invent extra considerations such as a fixed 3-minute first-response penalty.
- On an uncertainty, add note and request one adjudication; do not change it without writing why.
- If a model and your score disagree, return to the transcript and checklist before assigning fault.
- Keep final holdout labels private until provider selection is complete to prevent overfitting.
