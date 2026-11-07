# Six-person workflow: three humans + three supervised agents

## Human decision makers
- Denis — technical integrator; owns backend, shared contracts, scorer, external model/data calls, security, CI/deploy.
- Sofia — frontend owner; owns UX and frontend implementation and tests. She can self-merge owner-scoped low-risk changes after CI.
- Eldana — validation owner; owns annotation protocol, manual scoring, disagreement analysis, QA and presentation. Human labels must remain human-authored.
- Each person directs ONE primary agent. Agents implement/assist on their owner's issue only. An agent's changes are reviewed/accepted by its human. Humans, not agents, decide architecture tradeoffs, model selection, disputed ground truth and risky merges.

## Project organization
- Use one GitHub repository, one `main`, short-lived PR branches. No mandatory develop/integration branch.
- Each human works in their own clone; if multiple local agents share a computer use separate git worktrees or clones. Do not allow two agents to edit the same working directory simultaneously.
- Issue titles: `[P0][api] Add DEV import and validation`, `[P0][web] Transcript and evidence navigation`, `[P0][eval] Manual reference labels`.
- Labels: `priority:P0`, `priority:P1`; `area:api`, `area:web`, `area:eval`, `area:shared`, `area:ops`; `status:blocked`. Assignee is a real human account. Do not assign to an AI as if it were a person.
- One issue = one independently verifiable deliverable. Acceptance criteria must be testable; indicate dependencies. Create only actionable tickets that someone can actually start. Bug reports can be added as encountered.
- Human owner selects issue; agent may create a branch/commits/PR only when authorized. Agent should check issue is still open and no other PR addresses it. Use `gh` only if authenticated, remote verified, and authorization given.

## Git flow
1. `git fetch origin && git switch main && git pull --ff-only`
2. `git switch -c <owner>/<issue-number>-<slug>` (e.g. `sofia/12-transcript-viewer`).
3. Scope change to owned paths. Keep patches small and demonstrable. A draft PR can be opened before completion to signal ownership.
4. Run the relevant test/typecheck/build. Include actual commands/results in PR body, not unverified claims.
5. `git push -u origin <branch>` and open a PR to `main`. Use `Fixes #N` only when implementation fully satisfies that issue. Otherwise use `Refs #N`.
6. Human checks screenshots (UI), test logs (API), or sample annotations (QA). Fix issues; merge after checks. Delete feature branch after merge.
7. Pull latest `main` before next task.

## PR template and integration review
The PR must say: what changed, files/area, issue, how verified, behavior visible to user, unresolved problems, and any contract/env migrations. User-facing output must show evidence for new scoring behavior. A model-generated narrative is not verification.

### Merge policy under 24-hour deadline
- After Denis has created the **initial bootstrap commit** on an otherwise empty repository, protect `main` from direct pushes; require PR + fast CI once available; disable force pushes.
- Do NOT require a globally mandatory reviewer: teammates start at different times and may be offline. Use optional review requests by default.
- Owner-scoped low-risk PR (frontend rendering, annotation templates, docs) may be **human self-merged** after passing relevant checks and own review.
- Shared contracts, scoring logic, privacy/security, model prompt interpretation, GitHub settings, or deployment changes get **human cross-review** when feasible; Denis reviews others' critical changes, another human reviews Denis's critical changes when available. Before anyone else joins, Denis may merge his own critical foundation PR after focused tests and documented self-review, flagging it for retrospective human inspection. Never allow an absent reviewer to stall the project or quietly bypass a genuinely risky irreversible operation.
- Before control round, cut a green commit/tag; stop feature merges while processing new transcripts, apart from blocker fixes allowed before official stop-code.

## Contract changes without blocking another owner
- `docs/INTERFACES.md` describes the v0 API. Denis alone publishes/changes the shared `@cqa/contracts` implementation. Sofia reports a proposed signature with example payload rather than editing that package.
- Contract changes must have a dedicated `[area:shared]` issue and a compatibility note. Prefer additive fields and leave the mock running through integration.
- PRs that touch owned modules and shared contracts at once are discouraged; split contract PR first, then frontend/backend adaptation.

## First three actions by owner
1. Denis pushes docs → bootstraps contracts + fake fixture → announces ready SHA.
2. Sofia accepts invite → uses mock API for transcript/review UI → opens scoped PR.
3. Eldana starts manual labeling using organizer PDF/authorized data → commits only templates and safe guides → compares model predictions when available.

## The only synchronization checkpoints
1. **Bootstrap contract ready**: Denis publishes shared schema + mock API + fictional conversation. Sofia begins immediately on this, without backend. Eldana needs only rubric/DEV data locally.
2. **Integration checkpoint**: Denis's HTTP adapter matches mock interface. Sofia switches adapters. QA can start reporting end-to-end issues.
3. **Control freeze**: both flows and changed-rubric test pass; all humans rehearse demo.
No recurring long standups. Use small PRs and GitHub issue comments as asynchronous truth.

## Never-wait protocol
- If a dependency is missing, use a self-contained mock, generated fixture, adapter, or local test. Do not implement another person's unfinished code.
- Post one concise issue comment: **blocked by / required interface / workaround / next owner task**.
- If no update in 15 minutes, switch to a different ready issue (in your area). Don't ask repeated questions whose answer exists in contracts/docs.
- If requirements genuinely conflict, create one explicit decision item tagged `area:shared` and ask Denis. Otherwise make conservative, documented assumptions inside your area.

## Recommended initial backlog (assign numbers after GitHub creation)
| Owner | Priority | Issue | Acceptance criteria |
|---|---|---|---|
| Denis | P0 | Workspace/contracts/mock scaffold | pnpm install and scripts work; typed API contracts + fictional data; frontend can run without backend |
| Denis | P0 | DEV importer + repository storage | Imports 65 records, preserves roles/timestamps/audio, no secrets committed |
| Denis | P0 | Pure scoring engine + tests | Exact scales; N/A only when allowed; 100-point normalization and 2dp; null when no applicable criteria; separate critical flag |
| Denis | P0 | Baseline provider/evaluation jobs | Unseen text evaluated from stored checklist; typed scores, verified evidence, provider errors; batch progress |
| Denis | P0 | Appeals + checklist version endpoints | Immutable source evaluation; reviewer override and deterministic recalculation; version changes effective without code edits |
| Sofia | P0 | Transcript and review mock UI | All 4 roles, message links, language, scoring display, audio link |
| Sofia | P0 | Checklist version editor | Add/replace criterion, weight/type/scale/N/A rule; save via API adapter |
| Sofia | P0 | Appeals and reviewer UI | Raise appeal, view source and decision, see original vs final scores |
| Eldana | P0 | Rubric decision guide + labels | Independently human-label ~10 calibration examples, then 20-25 total; cite indices and note uncertainty |
| Eldana | P0 | Case matrix and QA scenarios | Test per language, N/A, partial answer, verification, gross violations, score override, changed criterion |
| Eldana | P0 | Evaluation error report | Per-criterion confusion and total MAE; human disagreement adjudication; no cherry-picking |
| Denis | P1 | Jev vs Haiku vs stronger-model harness | Same fixed inputs, prompts, exact labeled cases; accuracy/cost/latency; no claim of universal winner |
| Team | P0 | Demo rehearsal and freeze | 5-minute scenario; new dataset/criterion; README, deploy and pinned public commit |

## Communication format (issue/PR comments)
`Status: working/blocked/ready-for-review; Changed: ...; Verified: ...; Blocker: ...; Next: ...`
Use specific files and issue links; no speculative updates. Agents must not mark tasks done when tests or actions failed.
