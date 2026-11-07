# Conversation Quality Analytics (CQA)

A working prototype that scores customer-support conversations (RU / KZ / EN, chat and voice) against a **changeable, versioned checklist**, shows the evidence for every score, and lets a reviewer correct or appeal any criterion without losing the original AI result. Built for the CQA hackathon.

## What it does

1. **Imports** conversations from the organizer's dataset API (server-side) and keeps transcript text, order, roles, timestamps and audio link intact, adding a stable zero-based index per message.
2. **Evaluates** any conversation against the active checklist. Rules and earlier results answer what they can prove; a model answers only the semantic remainder; code validates the answer and computes the total.
3. **Shows evidence**: every verdict links to exact messages (with quotes) or to the inspected range for an absence; voice calls play with a waveform synced to the transcript.
4. **Edits the checklist in the UI**: add, replace, re-weight or disable a criterion → saved as a new immutable version → applied to the next evaluation with no code change.
5. **Reviews**: reviewers correct a criterion or decide an appeal; the final total is recalculated by code, the initial AI result and the audit history are preserved.
6. **Measures itself**: a CLI compares model output with human labels per criterion and measures run-to-run stability.

## Run it (5 minutes)

Needs Node ≥ 22 (CI uses 24) and pnpm 10. No API key or `.env` is needed to look around; stored evaluations open without a model, a new evaluation needs `ANTHROPIC_API_KEY`.

```bash
pnpm install
pnpm dev            # web http://localhost:5173 with fictional mock data, API on :8787
```

Full local build, one process on one URL (what the demo uses):

```bash
pnpm seed                # installs the committed DEV snapshot: 65 conversations, 66 evaluations, 5 recordings
cp .env.example .env     # optional: ANTHROPIC_API_KEY to evaluate new conversations
pnpm start               # builds, then serves web + API at http://127.0.0.1:8787
```

Checks: `pnpm typecheck && pnpm test && pnpm build` (no test needs a network or a model). Details, backup advice and troubleshooting: [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## Reading guide for reviewers

| If you want to check… | Look at |
|---|---|
| The big picture, data flow, decisions | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| That scores are not hardcoded and new input is really analyzed | `apps/api/src/services/evaluation/evaluator.ts` (`planCriteria`, `evaluateConversation`); no code references a conversation id |
| That the model cannot invent evidence or totals | `validateModelOutput` in `evaluator.ts`; `packages/contracts/src/evidence.ts`; `scoring.ts` |
| Arbitrary checklist support | `packages/contracts/src/checklist.ts` (schema, criterion signature), `apps/web/src/features/ChecklistEditor.tsx`, `scoring.ts` (id-agnostic) |
| Original-vs-final, appeals, audit | `apps/api/src/services/appeals.ts`, table `appeals`/`evaluations` in `db/schema.ts` |
| The organizer rubric and our reading of it | [`docs/RUBRIC.md`](docs/RUBRIC.md), `apps/api/src/checklists/original.json` (organizer PDFs are kept locally in the git-ignored `docs/official/`) |
| How accuracy is measured | [`docs/VALIDATION.md`](docs/VALIDATION.md), [`evaluation/README.md`](evaluation/README.md) |
| UI rules | [`docs/DESIGN.md`](docs/DESIGN.md) (a test enforces the 4/8 px grid) |
| Shared types and API | `packages/contracts/src`, [`docs/INTERFACES.md`](docs/INTERFACES.md) |

### Try the main flow

The interface is in Russian; labels below are given as `Russian (English)`.

1. Open **Диалоги (Dialogs)**, pick a conversation. If it has no stored evaluation, press **Оценить диалог (Evaluate dialog)** (needs a model key; the mock data already has results).
2. Click a criterion → the transcript jumps to the exact evidence message; for a call, click the waveform to seek.
3. Open **Чек-лист (Checklist)**, change a criterion's instructions or add one, save, then evaluate again → a new checklist version appears in the version bar; the old evaluation stays.
4. Override a criterion with a reason, or file and decide an appeal in **Апелляции (Appeals)**: the final total changes while the original total and the AI explanation remain visible.
5. Download CSV or print/save PDF from the evaluation panel footer.

## Architecture in one picture

```
  apps/web (React, CqaApi)  ──HTTP──▶  apps/api (Fastify) ──▶ SQLite  (+ data/private/audio)
        │ mock client for dev/tests            │
        └───────── packages/contracts ◀────────┘   Zod types · the single scorer · evidence check
                                               │
                         planCriteria:  detector rule → reuse → (assisted) model
                                               │          └ validated, stamped, scored by code
  evaluation/ (CLI)  reads the API: human labels vs model, stability reruns
```

Design principles (each is enforced by code or a test, not only by convention):

- **Deterministic first.** Facts (hold windows, recording pauses, verification events, timings), applicability, tiers, N/A, weighting, rounding and totals are code. The model supplies only semantic judgments and cannot compute a total.
- **Evidence or it did not happen.** A positive verdict needs a verbatim quote from a client-facing operator message; indices and quotes are verified against the stored transcript.
- **Nothing is overwritten.** Conversations, checklist versions, AI results and appeals are immutable/append-only; reviewer actions only change the *final* result.
- **Transcripts are untrusted data**, passed to the model as an inert payload; secrets stay on the server.

## Repository map

```
apps/api/          Fastify API, SQLite (Drizzle), import, evaluation pipeline, appeals, audio
apps/web/          React + Vite review app (works offline against MockCqaApi)
packages/contracts Zod schemas, shared types, scoring, evidence validation
evaluation/        Human-label sheets, model-vs-human comparison, stability CLI
fixtures/          Fictional demo conversation (only conversation data in git)
data/              git-ignored contents: SQLite, raw dataset, recordings
docs/              Architecture, rubric, interfaces, design, validation, runbook, workflow
handoffs/          Per-owner onboarding notes from the hackathon kickoff
AGENTS.md          Rules the team's coding agents follow (CLAUDE.md imports it)
```

## Team and process

Denis: API, contracts, scoring, providers, integration. Sofia: web app. Eldana: validation, labeling protocol, QA. Branch/PR/CI rules: [`docs/WORKFLOW.md`](docs/WORKFLOW.md); CI runs typecheck, tests and build on Ubuntu and Windows.

## Data handling

No signed organizer URL, API key, raw transcript, real audio URL, recording or private label file is committed (`.gitignore` covers `data/`, `.env*`, `evaluation/private/`, `*.sqlite`). Git holds only fabricated fixtures. Real conversations are sent to a hosted model only with confirmed permission.

## Known limits

Agreement figures in our reports are against team-written human labels, not the organizer's hidden reference. Rounding of halfway cases and the semantic relevance of a quoted operator message are judgment calls documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#13-known-limits). There is no authentication.
