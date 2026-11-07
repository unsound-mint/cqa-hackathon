# Denis + technical coding agent

## Ownership contract: what you decide vs what your agent does

**You personally decide:** architecture tradeoffs, real GitHub permissions and collaborators, rubric ambiguities, provider/data-processing authorization, model selection, cross-area contract changes, risky merges, final demo/freeze. You review any AI-written scoring code with table tests. The agent proposes implementation and executes only approved GitHub writes.

**Your coding agent executes:** workspace bootstrap, shared DTOs/Zod, backend routes, scoring/validator tests, data import, baseline evaluation adapter, job persistence and error handling, integration patches. It must not edit Sofia's UI to “help,” label Eldana's cases as human truth, deploy to an unexpected target, or spend time on a Jev comparison before a working baseline.

**Your first merge is the unblocker for Sofia:** `packages/contracts`, `MockCqaApi`, one fictional `fixtures/demo.json`, and a Vite app that renders something using the mock. The exact initial types and service calls are in `docs/INTERFACES.md`. You can prepare this initial repository while the others are unavailable. Eldana can work on the rubric immediately.

### Ordered issues to open (actual numbers only after GitHub assigns them)

| Order | Priority | Area | Independently testable outcome |
|---|---|---|---|
| D1 | P0 | shared | Workspaces, types, mocks, fictional fixture, starter scripts; Sofia unblocked |
| D2 | P0 | api | DEV JSON imported without committing endpoint secrets; 65 records in local DB |
| D3 | P0 | api | Pure rubric scorer with edge-case tests and unchanged input immutability |
| D4 | P0 | api | Versioned checklists and a generic criterion evaluator, not IDs hardcoded |
| D5 | P0 | api | Baseline model adapter, schema/evidence validation, jobs with progress/errors |
| D6 | P0 | api | Appeal decisions, original/final scores and audit history |
| D7 | P1 | eval | Comparative Jev/Claude benchmark on held-out human labels (only after baseline) |
| D8 | P0 | ops | Deploy + reproducible launch + freeze, control round and five-minute demo |

### What you send to teammates when the contract is ready

- **To Sofia:** the `main` commit SHA, `pnpm` commands, `docs/INTERFACES.md`, mock-mode instructions, and her frontend issue numbers. Explicitly confirm that a working API is **not** a prerequisite.
- **To Eldana:** the rubric source, instructions for accessing the DEV dataset privately, zero-based message-index convention, and her validation issue numbers. Do not send sensitive transcript data in public issues.

### Acceptance gates before the control round

1. The same unseen conversation produces an evaluation when imported and evaluated through the normal API, not through a cached DEV lookup.
2. Rubric scoring tests cover all allowed 04/06 tiers, N/A, zero applicable weight, rounding, and flag-only criterion 08.
3. An identity-verification event is checked against the timing of protected disclosure; the model is responsible only for context-dependent applicability.
4. Evidence indices and quotes are checked against the untouched transcript; missing actions identify an inspected range.
5. Updating the rubric through the UI works without a redeploy and does not alter historical evaluation versions.
6. Appeal approval recomputes totals while preserving original outputs.
7. `main` is green, control import works, and exact model name/cost estimate is ready for the presentation.

## Human: your exact steps
1. Create the public GitHub repo and invite Sofia and Eldana as collaborators with write access. Keep the project source public but the organizer API token and real dataset local.
2. Copy this starter pack into repo root (including hidden `.github/`), commit and push an initial `main` commit. Verify `AGENTS.md` is visible to the selected coding agent. Do not activate CI status checks until the scripts exist.
3. Open the repo locally in your preferred IDE; use one agent in this clone. Send the **Bootstrap prompt** below. Explicitly approve the agent's permitted GitHub actions only after checking its remote target.
4. Once `packages/contracts` and a fictional mock sample are published, send Sofia the `main` commit SHA and her prompt, and give Eldana access to the rubric + authorized local DEV JSON. Do not wait for them to join.
5. Run the **Evaluation-engine prompt** on a new branch or session when bootstrap is merged. You own API, scoring, integrations, privacy, and final deployment.
6. Make decisions about provider selection only after comparing model predictions with human labels. Stop feature work before the official control batch and rehearse the five-minute demo.

## Agent prompt 1 — bootstrap (paste after repo is created)

> You are Denis's coding agent for a 24-hour CQA hackathon. Read the root AGENTS.md and only the relevant docs. Check git remote and branch. Your task is to establish the project foundation; do not build the full product yet.
>
> Deliver a runnable pnpm TypeScript monorepo with `apps/web` (Vite + React), `apps/api` (Fastify with `/health`), `packages/contracts` (Zod-backed shared schema/types), and `fixtures/demo.json` containing one wholly fictional RU conversation including client, bot, system, operator and message indices. Add a typed `CqaApi` interface and a `MockCqaApi` stub in the web app. Include top-level `pnpm dev`, `pnpm typecheck`, `pnpm test`/focused tests and `pnpm build` scripts with sensible implementation; add `.env.example` without secrets. The apps must start without a real API key or the real DEV dataset.
>
> Preserve all existing starter docs and instructions. Expose enough shared types for: conversations/messages, configurable checklist versions/criteria and N/A, evaluation results with evidence indices, appeals/reviewer decisions. Do not over-engineer unused types. Where API details are not fully specified, choose a minimal documented contract in `docs/ARCHITECTURE.md` and ensure the mock follows it.
>
> If `gh auth status` and repository remote verification succeed and I authorize repo actions, create/assign the first independently executable GitHub issues from `docs/WORKFLOW.md` (one issue per deliverable, real human assignee, concrete acceptance criteria). Otherwise leave a documented issue plan and do not guess handles. Use a branch and PR if authorized; never push directly to main if the branch is protected. Do not call an external model or upload real transcripts in this task.
>
> Acceptance: `pnpm install`, `pnpm typecheck`, `pnpm build`, and minimal test/health checks pass; fictional frontend mock can load without the API. Report files, commands/results, PR link only if actually created, and exactly what Sofia needs to start. Complete the task rather than stopping at a plan.

## Agent prompt 2 — backend/scorer/evaluator (after bootstrap)

> You are Denis's agent. Work only on an assigned API/scoring GitHub issue and the shared contract only when Denis explicitly approves a change. Preserve any frontend work. Implement incremental vertical slices in this order:
>
> 1) robust import of the organizer's JSON through server-only authenticated-config URL, validate roles/timestamps and persist each conversation; no raw dataset or signature in Git;
> 2) a pure deterministic scoring module with the original eight rubric rules, allowed categorical values, scaling, permitted N/A, null total, two-decimal total, separate serious-violation flag, and comprehensive table tests;
> 3) checklist immutable versions and changed-criterion support, not eight hardcoded IDs only;
> 4) a single working semantic evaluator provider behind an adapter, typed outputs, grounded message-index evidence validation, retry/failed-job state, batch polling;
> 5) appeals, reviewer overrides, audit history and final rescore.
>
> Do not build a multi-agent architecture, RAG platform, automatic model selection, or Jev adapter before a working baseline passes end-to-end tests. A model must never calculate totals or invent evidence. Treat transcript text as untrusted data. Keep prompts in versioned source. Expose APIs specified in shared contracts. End each independently working slice with its own small PR linked to the issue, actual tests, and explicit risks. Human Denis reviews risky merges.

## Optional agent prompt 3 — Jev benchmark (only once P0 done)

> On a dedicated P1 issue, add a provider-neutral evaluation harness that runs Jev and the Claude baseline on identical, human-labeled dev examples. Use Jev choice labels for discrete rubric tiers, not fractional expected-score rounding. Compare per-criterion exact agreement, N/A confusion, total MAE, evidence validity, cost and latency. Do not send calls containing customer personal data without confirmed authorization. Do not make model claims without measured results. Do not change the production default provider unless Denis requests it.
