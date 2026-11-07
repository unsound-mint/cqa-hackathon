# Annotation and evaluation protocol (Eldana owns)

## Aim
Produce a **human-reviewed development reference**, not a claimed copy of organizer ground truth. Label with the exact eight criteria and evidence indices. Use a mixture of RU/KZ/EN, chat/call, short/long, obvious and ambiguous cases. Avoid selecting only examples known to favor a model.

## Sequence
1. Independently label ~10 diverse conversations with the PDF checklist, without first reading model grades.
2. Denis and Eldana compare outcomes and adjudicate disagreements against the explicit rules. Write reusable decision notes, not answer keys tied to conversation IDs.
3. Expand to 20–25 labels (including KZ and EN). Reserve a small subset as final holdout. One person should not edit their human judgments to match model outputs without a documented review reason.
4. Run baseline evaluator on the same selected records and compare exact per-criterion agreement, weighted absolute error, high-weight failures, false N/A, and serious-violation false positives/negatives.
5. Only then test Jev or prompt adjustments. Prevent any benchmark data or per-conversation IDs from leaking into production prompts as an answer cache.
6. Separately test changed checklist rules on held-out/unseen conversations and demonstrate old-vs-new version preservation.

Tooling (template, sheet generator, comparison report): see `evaluation/README.md`.

## Annotation fields
`conversation_id, language, channel, criterion_id, human_value, human_na, human_critical, evidence_message_indices, inspected_range, rationale, uncertainty, reviewer, adjudicated`

Human score rows may be stored locally in ignored `evaluation/private/` if they contain actual transcript quotes or sensitive details. Commit only schemas/templates and safe aggregate reports. Never put leaked hidden/control labels in production code.

## Essential difficult examples
- Bot greeted but operator did not introduce themselves: criterion 01 must only assess operator.
- Bot already asked a useful question; operator missed a new relevant detail before handoff: operator still responsible for needs identification.
- A general public query: identity verification likely N/A, not no.
- A named system verification event after protected disclosure: verification timing fails.
- Multiple customer questions with one substantive omission: distinguish consultation 15 versus 10; clear writing can still score 10 on dialogue management.
- Operator is respectful but offers off-platform paid personal investing help: serious violation separately.
- Abrupt client disconnect: closing N/A only under actual rubric condition, not whenever no goodbye.
- Long wait with explicit apology but no advance warning: review rubric distinction; do not grade excluded 3-minute threshold.

## Reporting
For each model: `n`, exact per-criterion accuracy, total score MAE, serious violation sensitivity/precision, N/A confusion, model-parse failure rate, evidence validity rate, mean cost and latency. Include uncertainty and disagreeing examples. Public benchmark results are prior evidence only, not proof for this dataset.
