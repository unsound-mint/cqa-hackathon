# Offline labeling delivery — issue #34

Reuse the existing Russian labeling page and its transcript/evidence controls. Generate a private standalone HTML file from validated conversations and an explicit checklist version. Bundle the shared scorer and CSV writer; replace only the page's API adapter. Keep all human answers blank initially.

Store current labels plus append-only change history in browser storage under a dataset/checklist-specific key. Provide JSON backup/restore (including history) and CSV export compatible with the existing comparison CLI. Validate restored labels against the checklist and transcript before accepting a backup. Include Russian handoff instructions and the authoritative rubric PDF alongside the generated file when available.

Verify with fictional data: script-safe embedding of hostile transcript strings, invalid evidence/values rejected, CSV parsed by existing tooling, browser answering/evidence/typing/reload/backup/restore. Generate the actual private delivery kit from local DEV data without committing it. Preserve unrelated frontend edits.
