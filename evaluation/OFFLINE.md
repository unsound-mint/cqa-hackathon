# Send Eldana an offline labeling kit

Eldana needs no account, repository, agent, server or network connection. The kit contains the transcript data, the selected checklist and the existing labeling interface. It contains no model predictions. Send it only through an authorized private channel.

From the repository root:

```
pnpm --filter @cqa/evaluation exec tsx src/make-offline.ts --data "$PWD/data/raw/dev.json" --out "$PWD/evaluation/private/eldana/Разметка.html"
cp evaluation/ELDANA-INSTRUCTIONS.txt evaluation/private/eldana/НАЧНИ-ЗДЕСЬ.txt
cp docs/official/CQA_Chat_Quality_Checklist.pdf evaluation/private/eldana/
```

The generator refuses invalid/partial data and refuses to overwrite an existing delivery file. Pass `--checklist /absolute/path/to/version.json` to select another immutable checklist. Output is private; never commit generated HTML. Package the three files in a ZIP and send privately. The recipient extracts the ZIP, opens the HTML in Chrome/Edge and follows the Russian instructions. Keep the original HTML unchanged between sessions.

Answers and append-only edit history are saved in browser localStorage under a hash of the exact dataset and checklist plus a unique reviewer profile ID. Browser/file storage behavior varies: exported backups are the portable source of recovery. The UI flushes pending edits before switching conversations and exporting. Unsaved or invalid drafts trigger a leave-page warning. Storage errors are visible; do not clear browser data to resolve them.

Ask Eldana to return both their named `labels-*.csv` and `backup-*.json` after each session. The CSV includes blank rows for unlabelled criteria; the comparison CLI reports them as incomplete. Run the existing `compare --labels /absolute/path/to/eldana-labels.csv` command against the API containing the same conversations/checklist. The JSON holds the original human history, including subsequent clears; retain it privately. Restore only into empty browser storage; existing work is never overwritten. Multiple independent backups require explicit human adjudication, not last-write-wins merging.

## Verification

```
pnpm --filter @cqa/evaluation typecheck
pnpm --filter @cqa/evaluation test
node evaluation/browser/offline.mjs /absolute/path/to/fictional-kit.html
```

The browser check must use a kit generated from **fictional** data: it deliberately chooses answers. Set `CQA_BROWSER_EXECUTABLE` if Chromium is elsewhere. The generator bundles local code only, with no CDN or external requests. Audio links require network access if opened. Optional server access tokens are unnecessary for a standalone file; possession of the private HTML grants access to its contents.

## Independent reviewers

Send the same kit to each person. Different laptops store work independently. On a shared laptop, use «Новый рецензент» to create a blank review, and the «Рецензент» selector to return to a previous review. Every profile has separate current answers, progress and append-only history. Reviewer attribution is bound to that profile; exports carry the name and a short unique ID. Profiles are workflow separation, not authentication or a privacy boundary on a shared computer.

Keep each person’s CSV/JSON separately. Run the comparison CLI with each CSV separately; do not concatenate files (the same conversation/criterion pairs are intentional independent judgments). Discuss disagreements against the rubric while retaining the original independent backups. Restoring into an empty profile preserves the imported reviewer name and history.
