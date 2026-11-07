# Initial issue plan

D1-D6 exist on GitHub as #1-#6, assigned to the repo owner. S*, E*, D7+ are not created yet.

S*/E* are created only once Denis confirms each person's GitHub login (none are known; the repo has only its owner as collaborator and no invites, so assignment is impossible until Sofia and Eldana are invited). Labels `priority:*`, `area:*`, `status:blocked` do not exist yet. Format follows `docs/WORKFLOW.md`; numbers are assigned by GitHub.

| Key | Title | Assignee | Acceptance (summary) | Depends |
|---|---|---|---|---|
| D1 (#1) | [P0][shared] Workspace, contracts, mock scaffold | Denis | install/typecheck/test/build green; fixture + `MockCqaApi`; web renders with API down | none |
| D2 (#2) | [P0][api] DEV import + storage | Denis | 65 records imported via server-only URL (importer must override its `group_id` param: control round uses another group); roles/timestamps/audio preserved; no secret/data in git | D1 |
| D3 (#3) | [P0][api] Pure scoring engine + tests | Denis | extend `contracts/src/scoring.ts`; tiers, N/A, null total, rounding decision, flag; table tests | D1 |
| D4 (#4) | [P0][api] Versioned checklists + generic evaluator | Denis | `POST/GET /api/checklists`; changed criterion evaluated without code edits | D1 |
| D5 (#5) | [P0][api] Baseline provider + jobs | Denis | typed output, evidence validated by `findEvidenceProblems`, retry/failed state, progress | D3, D4 |
| D6 (#6) | [P0][api] Appeals + audit | Denis | override recalculates final only; originals immutable | D3 |
| S1 | [P0][web] Conversation list + transcript | Sofia | 4 speakers, raw timestamps, filters | D1 |
| S2 | [P0][web] Evaluation detail + evidence jump | Sofia | click evidence -> exact 0-based message, identical timestamps safe | S1 |
| S3 | [P0][web] Checklist editor | Sofia | add/replace criterion, save new version via `CqaApi` | D1 |
| S4 | [P0][web] Appeals + reviewer UI | Sofia | original vs final distinguishable | S2 |
| S5 | [P0][web] `HttpCqaApi` integration | Sofia | switch in `createApi()`; loading/error states | D4-D6 |
| E1 | [P0][eval] Rubric guide + human labels | Eldana | 10 calibration then 20-25 labels, human-authored | none |
| E2 | [P0][eval] Case matrix + QA scenarios | Eldana | per language, N/A, verification, override, changed criterion | D1 |
| E3 | [P0][eval] Error report | Eldana | per-criterion confusion + total MAE | D5, E1 |
