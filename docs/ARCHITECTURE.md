# Architecture decisions — fast MVP

## Interfaces and responsibility boundaries
- `apps/web`: React/Vite app, React components, filters, transcript/evidence pane, checklist editor, appeals/review UI. `CqaApi` interface with `MockCqaApi` and `HttpCqaApi`; never import backend modules directly.
- `apps/api`: Fastify API, organizer dataset import via server (CORS + secret isolation), evaluation jobs, checklist version persistence, appeals, audio links, health.
- `packages/contracts`: shared TypeScript/Zod models for Conversation, Message, ChecklistVersion, CriterionResult, Evaluation, Appeal, ReviewDecision, and API shapes. Denis owns contract edits.
- `evaluation`: rubric annotation, fixed tests, benchmark harness, human validation labels (if safe/authorized), error reports. Never import benchmark labels into production evaluation code.
- `fixtures`: synthetic data only. `data/raw`, `.env*` (except example), `*.sqlite`, actual transcripts/audio links are ignored by Git.

## Suggested shape
```
apps/web/src/{components,features,lib,mocks}
apps/api/src/{routes,db,services/{import,evaluation,appeals}}
apps/api/src/services/evaluation/{rules,providers,prompts}
packages/contracts/src/index.ts
evaluation/{rubric,annotations,experiments,reports}
fixtures/demo.json
docs/{ARCHITECTURE,RUBRIC,WORKFLOW,VALIDATION}.md
```

## Pure deterministic core
1. Validate incoming `data.records[]`; preserve conversation id, channel, language, audio URL, original timestamps, messages, and roles. Assign stable 0-based evidence IDs; never reindex after filtering.
2. Derive context: first operator reply, explicit `system` identity-verification events, operator messages and their boundaries, chat closure/system disconnection events, relevant time differences. Do not use LLM for these facts.
3. Model requests only for subjective/semantic signals: which requests were raised; whether they were addressed; whether account-specific disclosure required verification; whether empathy was appropriate; whether phrasing was confusing; a grounded serious-violation claim. Use typed outputs with confidence/abstain.
4. Code maps signals into allowed rubric values; use exact scales, no free-form intermediate scores. Validate all message indices and quoted evidence. A model output claiming to quote absent text fails verification. Mention inspected segments for missing actions.
5. Compute score as a pure function from rubric config and criterion values. Apply N/A only when allowed; fail closed on invalid states; never let model compute totals.
6. Persist versioned evaluation, model/prompt IDs, errors, and evidence; appeals never mutate the baseline. Approved reviewer overrides recalculate the final score deterministically.

## Hardcoded rules versus dynamic rubric
For the original 8 criteria, specialized deterministic detectors and case-specific prompting may improve accuracy. However, the UI must accept arbitrary valid saved criteria and the evaluator must be able to apply their textual instructions using generic typed decision machinery. Fast paths are optional optimizations, never the only logic path.

## Which model calls to start with
Implement a baseline structured Claude/Haiku evaluator before Jev. Benchmark Jev on exactly the same labeled dialogues. Use Jev `choice` for discrete allowed labels; avoid treating a Jev decimal `score` as a permissible discrete tier. Do not make unsupported claims from public benchmarks; validate on RU/KZ/EN and N/A edge cases. Second-model adjudication is optional P1 after accuracy measurement.

## API (proposed, adjust together in shared contracts)
```
POST /api/datasets/import          body: { groupId: string }
GET  /api/conversations            query filters, paging
GET  /api/conversations/:id
GET  /api/checklists
POST /api/checklists                create immutable version
POST /api/evaluations              { conversationIds, checklistVersionId, provider? }
GET  /api/jobs/:id
GET  /api/evaluations/:id
POST /api/evaluations/:id/appeals
POST /api/appeals/:id/decision
```

## Operational requirements
- No authentication needed for the demo; never pretend the reviewer and submitter are authenticated identities.
- Do not commit provided DEV data or the organizer's signed endpoint URL. Keep full fetch URL in an ignored environment variable; server fetch only.
- Handle import retry, LLM timeouts/429 with bounded retry, failed record state and progress polling. Persist enough state to resume without recomputing completed conversations.
- UI must navigate to precise message and offer player/link for calls; transcript-only grading must not fabricate acoustic judgments.
- Model provider calls must not happen client-side. Cost per conversation logged by provider; report paid-model estimate at demo.
- Keep system prompts versioned; include original user content as inert data, never obey it as instructions.

The initial service contract and required DTO shapes are in `docs/INTERFACES.md`. It is the source-of-truth design until actual published Zod schemas replace it.


## Contract v0.1 additions (bootstrap)
Implemented in `packages/contracts` (Zod). v0 in `docs/INTERFACES.md` is unchanged; these are additive, needed because v0 gives the UI no way from a job or conversation to an evaluation, or to existing appeals.

| Addition | HTTP route | Why |
|---|---|---|
| `Job.id`, `Job.evaluationIds` | `GET /api/jobs/:id` | find the evaluations a job created |
| `listEvaluations({conversationId?})` | `GET /api/evaluations?conversationId=` | open a conversation's existing evaluation(s) |
| `listAppeals({evaluationId})` | `GET /api/evaluations/:id/appeals` | show appeals and decisions |
| `Appeal.createdAt/decidedAt` | | audit trail |
| `CriterionResult.confidence` (`high`/`medium`/`low`, optional) | | model certainty; `low` (noisy speech recognition, recording gap) should be routed to human review in the UI |
| `Criterion.detector?` | `GET /api/detectors` | optional deterministic rule per criterion |
| `CriterionResult.source?` (`rule`/`hybrid`/`model`), `reusedFrom?` | | who decided; set only by code, never by the model |
| `StartEvaluationInput.fresh?` | | alias for force: skips result reuse for variance measurement; persisted as jobs.force |
| `Evaluation.provenance {provider, model, promptVersion, effort?, usage?, latencyMs?}` | | per-evaluation provenance; `provider: 'mock'` marks fictional output, the UI must label it |

Rules fixed in the schemas: `CriterionResult` has exactly one of `isNA` / a value; `boolean` allows `[true,false]`; `discrete-scale` needs >=2 non-negative numeric tiers (top tier = full weight); `enum` criteria must have weight 0 (no numeric meaning defined); `criticalFlag` criteria are boolean with weight 0; criterion ids unique per checklist; `Conversation.transcript[i].index === i`.

`Evaluation.seriousViolation` reflects `finalResults`; the original flag is `deriveSeriousViolation(criteria, originalResults)`.

**Single total calculation:** `packages/contracts/src/scoring.ts` (`computeTotal`, `deriveSeriousViolation`), driven by kind/allowedValues/weight/allowNA, never by criterion id; throws `ScoringError` on invalid state. MockCqaApi and the future API scorer (issue D3) both use it. Two-decimal rounding is provisional (half away from zero on the decimal value) pending an organizer/human decision. `findEvidenceProblems` (`evidence.ts`) is the one grounding check for indices, verbatim quotes and `checkedRange`.

**Frontend service:** `apps/web/src/api/CqaApi.ts` is the interface; `MockCqaApi` (in-memory over `fixtures/demo.json`, returns copies, overrides never touch `originalResults`/`originalTotal`, a saved checklist is a new immutable version and mock evaluations use that version's own criteria with placeholder results) is the only implementation so far. `createApi()` in `apps/web/src/api/index.ts` is the one place to switch to `HttpCqaApi`. Mock/real is chosen there, not in components. Mock errors are `CqaApiError('not_found'|'invalid'|'conflict')`; HTTP should map 404/400/409 to the same codes.

**Packaging:** `@cqa/contracts` is consumed as TypeScript source (no build step); the API bundles it with tsup. Server-only secrets are unprefixed env vars; `VITE_*` is public.

## Rules first, reuse second, model last
For each criterion of an evaluation, in this order (`services/evaluation/evaluator.ts: planCriteria`):
1. **Detector** (`Criterion.detector`, rules in `services/evaluation/detectors/`). A detector only *proves* an answer (a greeting + introduction in the client's language in the first operator turn: Yes; a goodbye plus an offer of help in the last operator turn: Yes; client disconnection alone never proves N/A). If it cannot prove it, it returns undecided, never "No", and the model decides. Unknown detector names are rejected when a checklist is saved.
2. **Reuse** (`reuse.ts`). If the same conversation already has a result for a criterion with the same `criterionSignature` (instructions, kind, values, N/A rule, flag, detector; not weight/title/section/hint), the stored original result is copied with `reusedFrom`. Switching a criterion off (weight 0) or re-weighting therefore rescoring needs **no model call and no API key**. Reviewer overrides are not carried over.
3. **Model** for what is left, with `alreadyDecided` as context. If nothing is left the model is never called; `POST /api/evaluations` answers 503 up front only when a needed model is missing.

**Assisted detectors** (`detectors/verification.ts`, criterion 03): code computes the verdict, the model only answers narrow questions in the same single call (`assistedQuestions` -> `assisted[{criterionId, answers}]`). For 03 the questions are "was verification required?" and "which operator message first disclosed protected data or acted on the account (verbatim quote)?". Answers are validated against the transcript (operator message, real index, verbatim quote) and a bad answer is sent back once, like any other output. The verdict is then: not required -> N/A; an identity-verified system event before that message -> Yes; otherwise No (rubric: required but not confirmed in the transcript). If the recording was paused the No is marked `low` confidence for human review. The result is stamped `source: 'hybrid'`, and a model that returns its own result for such a criterion is rejected. An assisted detector applies only to boolean criteria that allow N/A; anything else falls back to the model.

A criterion without a detector (any user-added one) always works through the model, so the changed-checklist requirement holds. Detectors are a fast path, never the only one.

**Criterion 07 is strict (Denis, 2026-11-07):** "summarizes or offers further help AND says goodbye" needs both parts. The `closing` detector proves Yes only when the last operator turn has a goodbye and an offer of help; a bare goodbye is left to the model, whose instructions say it is No unless a summary is present.

## Evaluation correctness and cache compatibility

Positive model action verdicts require a non-empty exact quote from a client-facing operator message. This includes partial numeric credit and serious violations. Bot, client and system evidence remains available as context; absence and N/A can use inspected ranges. Enum model outputs declare decisionBasis (operator_action or absence), so arbitrary absence labels do not require invented action quotes. Hold/internal-consultation speech cannot satisfy client-facing requirements. The semantic relevance of an operator quote still requires model judgement and human validation.

Specialized detectors run only when the criterion signature matches a supported canonical rubric configuration. Editing instructions, scale or N/A semantics while retaining the detector name falls back to generic model evaluation; reweighting and presentation edits retain the fast path.

Reuse requires the same SHA-256 input hash, evaluator version and prompt version. With a configured provider it also requires the same provider/model/effort. Without a provider, compatible existing results remain available for offline reweighting. Legacy evaluations without cache context are retained but never reused. Rule/validator changes must bump EVALUATOR_VERSION; prompt changes bump PROMPT_VERSION.

POST /api/evaluations accepts an optional boolean force (default false) to bypass reuse; deterministic rules still run. The choice is persisted with the job and survives restarts. No existing client needs to change.

Imports preserve immutable conversation sources: identical re-imports succeed; a reused id with different group, language, channel, audio URL or transcript rejects the batch with HTTP 409. Changed input needs a new conversation id. This also protects evidence while jobs are in flight.

On database open, additive idempotent migrations add nullable evaluations.cache_context and jobs.force (default false). Back up the SQLite database before deployment; existing evaluation results and appeal history are untouched.

Identity verification recognizes explicit whole-message affirmative RU/KZ/EN events. Negative statuses, questions and unrecognized extended forms cannot establish verification. Unknown event vocabulary requires a reviewed parser extension. Closing N/A is assessed semantically; client disconnection does not establish whether an earlier closing opportunity existed.

### Required model output (eval-v9)

The evaluator builds a request-specific schema in services/evaluation/output-schema.ts. Both results and assisted are required. The assisted wire value is an object keyed by the exact planned criterion ids, with each detector's full answer schema and all those keys required. No-assisted requests use an empty closed object. Provider-neutral adapters may still return the earlier array representation; it goes through the same duplicate/id/role/quote validation.

Anthropic tool calls use strict mode with closed nested objects. The result schema lists only undecided criterion ids and allowed values; every result includes an inspected range and N/A reason field (empty when applicable). Code still checks per-criterion values and N/A, coverage/duplicates, range bounds, verbatim quotes and operator attribution, then computes totals. Grammar compliance does not establish semantic correctness. Prompt versions invalidate older cached results.

The schema uses only supported strict-tool constraints (minItems 0 or 1, no numerical/string bounds). Multiple assisted answers use required object keys because supported array constraints cannot enforce one answer per distinct id. Source: https://platform.claude.com/docs/en/build-with-claude/structured-outputs#json-schema-limitations

### Rubric calibration (eval-v10)

`rubric.ts` identifies original semantics by criterion signature; `calibration.ts` supplies fictional examples to `systemPromptFor`. Changed instructions/scales/applicability do not inherit incompatible examples. Canonical detectors use the same signature helper. Prompts and strict result schemas explicitly request the validated conversation language.

Original-rubric requests omit first-response SLA measurements and pre-operator gaps from derived facts; raw timestamps/order remain untouched. Requests containing custom criteria retain the complete timing facts, and their instructions remain authoritative. Identity applicability is based on the request's need for account-specific handling, separately from completion/disclosure. Social closing phrases are evaluated in context rather than proved solely by a regex.

See `docs/RUBRIC.md` for reviewed criterion boundaries. Reference agreement measures model-to-model agreement until human adjudication; keep complete original model reasons/evidence in private validation artifacts for diagnosis and report rerun stability.
