# Local run and stage-demo runbook

The demo runs on one laptop (Fedora or Windows), as one process on one URL. No Docker.

## One-time setup
1. Install Node 24 and pnpm 10: commands for Linux, macOS and Windows are in the README ("Install prerequisites"). After installing Node, run `npm install -g pnpm@10.33.2` (the version pinned in `package.json`).
2. `pnpm install`
3. Copy `.env.example` to `.env`. Put `DATASET_IMPORT_URL` (server-only) and, once chosen, the model key there. Quote the URL if you source the file in a shell; the apps read it themselves and do not need quoting.
4. For a ready-to-inspect demo, run `pnpm seed`. It installs the committed DEV snapshot (`data/seed/`: database with 65 conversations, their latest evaluations and the directory, plus the 5 call recordings) without overwriting an existing database. To refresh the snapshot from your live database run `pnpm seed:export` (DEV conversations only, latest evaluation per conversation, directory kept; the control group and run history are never exported) and commit `data/seed/`. Re-run it before pushing whenever you changed data you want on other machines. It contains 65 completed evaluations and one failed attempt. The snapshot is the organizer-cleared DEV publication (2026-11-08).
5. `pnpm start` builds everything and serves web + API at http://127.0.0.1:8787 (`PORT`/`HOST` to change).
6. Alternatively, import the data once (not needed after `pnpm seed`): `curl -X POST localhost:8787/api/datasets/import -H "content-type: application/json" -d '{"groupId":"DEV"}'` (PowerShell: `Invoke-RestMethod -Method Post -Uri http://localhost:8787/api/datasets/import -ContentType application/json -Body '{"groupId":"DEV"}'`).

Production uses the HTTP backend and the evaluations already stored in `DATABASE_PATH`; it does not substitute mock results or automatically regenerate existing evaluations. Development instead: `pnpm dev` (web on :5173 with hot reload, API on :8787), defaulting to fictional mock data. Set `VITE_API_MODE=http` for integrated development or `mock` for an explicit fictional preview. Leave it unset/empty for the normal defaults.

## State
Working application state lives in one SQLite file (`DATABASE_PATH`, default `data/cqa.sqlite`; the raw download is in `data/raw/`). Both are git-ignored. **Copy `data/cqa.sqlite` before the demo**: restoring it brings back conversations, checklist versions, evaluations and appeals. Call recordings are stored next to it in `data/private/audio/` (`AUDIO_DIR` overrides; git-ignored, real calls), fetched after an import, on every server start for any that are missing, and on first play, so a demo does not depend on the organizer's signed links; copy that folder too.

The [reviewer guide](REVIEWER_GUIDE.md) is the presentation path; this runbook covers operations.

## Before going on stage
- Run the whole flow once on the stage laptop and screenshot it (backup).
- Decide the model path ahead of time. The configured hosted provider needs working internet and a funded key; no local-model adapter is included. Evaluations already stored in the database show without any model call, but new semantic judgments need the model. A checklist edit may reuse unchanged judgments; follow the [reviewer guide](REVIEWER_GUIDE.md) to demonstrate a new semantic criterion.
- Disable sleep and notifications; close heavy apps.
- Keep a second browser tab on `/health`.
- Freeze `main` at a green commit before the control round.

## If something breaks
| Symptom | Check |
|---|---|
| Blank page | `pnpm build` ran? `apps/web/dist` must exist; `curl localhost:8787/` |
| `better-sqlite3` install error on Windows | use Node 24 LTS; CI proves Windows install/test/build |
| Evaluation answers 503 | no provider configured (`ANTHROPIC_API_KEY` unset) |
| Import answers 502 | venue network or expired signed URL; use the copied database |
| Port in use | `pnpm stop` (frees the port), or `PORT=8788 pnpm start` |

## Submitting results (organizer appendix, JSON 1.0)
Two files must be pushed to the public repo before the stop-code: `results/dev/results.json` (65 DEV records) and `results/prod/results.json` (exactly 10 control chats, errors included). The exporter writes the immutable initial AI result (never reviewer overrides) in the required format and validates it (eight criteria once each, allowed values, 1-based evidence turns, score recomputed from weights, unique IDs).
Export from the evaluation snapshot **before rehearsing critical-flag corrections or appeals**. Current exporter limitation: criterion values come from the original result, but `critical_flag` reads the mutable reviewed flag. If review changes that flag, validation rejects the inconsistent export. Keep the submission snapshot separate from the review demonstration until the exporter is corrected.

1. Import and evaluate the control set in the app (all 10 conversations; an evaluation that fails is exported as `status: "error"`, never as a zero).
2. `node scripts/export-results.mjs --group <control group id> --out results/prod/results.json --team "<team name>" --expect 10` (DEV: `--group DEV --expect 65`).
3. `pnpm results:check results/prod/results.json --expect 10`, then commit, push, and confirm the file is visible on GitHub. Local commit without push does not count.

## Dynamics 365 (HTML web resource)
The guide asks for a UI that can later be adapted as a Dynamics 365 HTML component. Prepared, not exercised in a real Dynamics org: the build uses relative asset URLs (`base: './'`), routing is hash-based (no server rewrites), and the API origin is configurable. To embed: build with `VITE_API_BASE_URL=https://<api host>`, upload `apps/web/dist/index.html` and `dist/assets/*` as web resources keeping the `assets/` folder layout, and start the API with `CORS_ORIGIN=https://<org>.crm.dynamics.com`. The API must be reachable over HTTPS from the browser.
