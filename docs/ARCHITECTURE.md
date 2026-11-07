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
