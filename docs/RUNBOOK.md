# Local run and stage-demo runbook

The demo runs on one laptop (Fedora or Windows), as one process on one URL. No Docker.

## One-time setup
1. Install Node 24 and pnpm 10 (`corepack enable` works). Windows: use PowerShell or Git Bash.
2. `pnpm install`
3. Copy `.env.example` to `.env`. Put `DATASET_IMPORT_URL` (server-only) and, once chosen, the model key there. Quote the URL if you source the file in a shell; the apps read it themselves and do not need quoting.
4. `pnpm start` builds everything and serves the web app and the API at http://127.0.0.1:8787 (`PORT`/`HOST` to change).
5. Import the data once: `curl -X POST localhost:8787/api/datasets/import -H "content-type: application/json" -d '{"groupId":"DEV"}'` (PowerShell: `Invoke-RestMethod -Method Post -Uri http://localhost:8787/api/datasets/import -ContentType application/json -Body '{"groupId":"DEV"}'`).

Development instead: `pnpm dev` (web on :5173 with hot reload, API on :8787).

## State
Everything lives in one SQLite file (`DATABASE_PATH`, default `data/cqa.sqlite`; the raw download is in `data/raw/`). Both are git-ignored. **Copy `data/cqa.sqlite` before the demo**: restoring it brings back conversations, checklist versions, evaluations and appeals.

## Before going on stage
- Run the whole flow once on the stage laptop and screenshot it (backup).
- Decide the model path ahead of time. A hosted model needs working internet and a funded key; a local model (Ollama) works offline. Evaluations already stored in the database show without any model call, but a NEW conversation needs the model.
- Disable sleep and notifications; close heavy apps (a local 7-8B model needs most of the RAM).
- Keep a second browser tab on `/health`.
- Freeze `main` at a green commit before the control round (see `docs/WORKFLOW.md`).

## If something breaks
| Symptom | Check |
|---|---|
| Blank page | `pnpm build` ran? `apps/web/dist` must exist; `curl localhost:8787/` |
| `better-sqlite3` install error on Windows | use Node 24 LTS; CI proves Windows install/test/build |
| Evaluation answers 503 | no provider configured (`ANTHROPIC_API_KEY` unset) |
| Import answers 502 | venue network or expired signed URL; use the copied database |
| Port in use | `PORT=8788 pnpm start` |
