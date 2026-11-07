# Sofia + frontend coding agent

## Ownership contract: what you decide vs what your agent does

**You personally decide:** interaction flow, visual clarity, accessibility, whether the user can find/understand a grade, frontend PR acceptance, and which UI issues matter most for the five-minute demo. Test the running UI yourself; do not accept an agent's claim that it “looks good” without looking at it.

**Your coding agent executes:** `apps/web` components, fictional mock service and later HTTP adapter, frontend tests, screenshots where available, and scoped PRs. It must not edit `apps/api`, scorer, private labels, GitHub protections or `packages/contracts`. Request shared DTO changes in an issue rather than inventing incompatible duplicate types.

**Independent start condition:** the first Denis contract/mock commit is on `main`. You do **not** need imported DEV data, model credentials, or a running backend. Read `docs/INTERFACES.md` and build with `MockCqaApi` until the integration checkpoint.

### Ordered frontend issues

| Order | Priority | Outcome | Acceptance demonstration |
|---|---|---|---|
| S1 | P0 | Conversation list + transcript viewer | Select record; four speakers and raw timestamps displayed; no bot greeting counted as operator |
| S2 | P0 | Evaluation detail + exact evidence jump | Choose criterion; click evidence; exact 0-based original message is highlighted |
| S3 | P0 | Configurable checklist editor | Add/replace criterion; configure text, type, allowed values, N/A and weight; save version via mock client |
| S4 | P0 | Appeals + reviewer decision | File appeal; choose uphold/override with reason; original and final result remain distinguishable |
| S5 | P0 | Real HTTP integration | Swap mock for HTTP behind `CqaApi`; no component rewrite; loading/error states |
| S6 | P1 | Demo polish + accessibility | Focus/keyboard, narrow-screen handling and visual consistency verified |

### UI states to design, even before backend exists

- Imported but **unevaluated** conversation (do not invent a score).
- Evaluation **running** and **failed**, including retry affordance if backed by API.
- Completed evaluation with positive/negative/scale/N/A outcomes and visible criterion weight.
- Invalid or unavailable evidence reference (show an honest error rather than scrolling to the wrong message).
- Appeal awaiting reviewer decision; upheld vs overridden result.
- Original vs edited checklist version and old vs new evaluation.

### Your own manual verification

Walk through list → transcript → rubric result → evidence link → N/A → appeal → reviewer decision → final score. Confirm identical timestamps do not cause wrong links. Check RU/KZ/EN display, long messages, keyboard focus, audio recording affordance and small screens. Tests and screenshots accompany PRs. A mock end-to-end demo must be visibly labeled as mock; only the real API may be presented as live evaluation.

### If you need something from Denis

Comment on the issue with `Expected endpoint/type`, `Observed behavior`, `Minimal mock workaround`, `What I will implement next`. Continue mock-mode work. Do not wait or modify the backend. Submit a contract-change issue for breaking changes, so Denis can approve one small migration.

## Human: your exact steps
1. Accept the GitHub collaborator invite. Clone the repo and `git pull --ff-only` on `main` after Denis announces the first contracts + mock commit. You do **not** need a running backend.
2. Run `pnpm install` and the frontend `pnpm dev` command. Check the fictional conversation is available from `MockCqaApi`.
3. Select the frontend P0 issue (or create it with a clear user story and acceptance criteria). Paste the **Frontend prompt** to your own agent, in your own clone. Do not change backend/scoring files.
4. Review the actual UI locally: verify all four speaker types, visible evaluation evidence, keyboard-accessible controls and responsive layout. Request corrections from your agent and merge the passing frontend PR if within your scope.
5. Continue with the **Editor and appeals prompt** on a separate issue/branch. Keep the frontend functional with mocks until Denis's HTTP API is ready.
6. For integration, adjust only the `HttpCqaApi` adapter to match the agreed contracts. Send a concise issue comment for any API mismatch; do not rewrite backend types.

## Agent prompt 1 — frontend review workspace

> You are Sofia's coding agent. Read root AGENTS.md and relevant docs, then inspect the existing frontend and `@cqa/contracts`. You are responsible for `apps/web/**` only. The backend is under independent development. Do not wait for it or edit it.
>
> Implement a coherent, accessible Conversation Quality Analytics review workspace in React/TypeScript, using the existing project styling choice (if not yet chosen, Tailwind with a modest consistent component library). Build (a) a searchable conversation list with language and channel filters, (b) transcript pane with client/operator/bot/system visual distinction, original timestamps, and audio link when present, (c) evaluation results pane containing criterion outcome, weight, rationale, evidence, N/A reason and original/final score when available, (d) clicking evidence index scrolls to and highlights the exact transcript message, including repeated or identical timestamps. Preserve stable zero-based message IDs.
>
> Work against `MockCqaApi` and fictional fixtures. Do not require live LLM keys, real DEV dataset, or a working backend. Use `@cqa/contracts` rather than duplicating DTOs. Show loading, empty and error states; no fake claim that a model has evaluated something unless a fixture represents it.
>
> Acceptance: web app launches with mocked data; a manual user can navigate list → conversation → criterion → message evidence, and there are no TypeScript/build errors. Add focused component tests where useful. Avoid changing `packages/contracts` without Denis's approval. Keep design attractive but do not invent additional product sections. Prepare a short PR linked to the issue and include screenshots or visual evidence when possible. Complete the change, not just the plan.

## Agent prompt 2 — checklist editor and appeals

> Continue as Sofia's frontend agent, on NEW issues/branches. Add a configurable checklist editor driven by the shared schema: create a new immutable version, edit criterion text, weight, answer type and scale, permitted N/A with explanation, and save; do not assume exactly eight criteria. Build appeal submission and reviewer decision UI with separate original and final evaluation. Connect through `CqaApi` methods with mock and HTTP implementations. For unsupported backend routes, keep the mock implementation working and post the required API contract in the issue; do not block. Acceptance is a complete offline mock demo of change-checklist → re-evaluate mock record → appeal → reviewer override → updated total (mock values clearly identified as mock). Add focused UI tests; submit scoped PRs.

## Human acceptance check
- Can I find a conversation without instruction?
- Does the transcript distinguish operator from the bot that greeted the client?
- Does a click on evidence highlight the correct indexed line, not only same timestamp?
- Does N/A explain the reason rather than only display a badge?
- Can the reviewer compare initial and final values?
- Can a changed/added criterion be saved through an actual form rather than hardcoding text?
