# Semantic facts implementation plan

**Goal:** Make original criteria 02, 04 and 06 grades follow validated facts and rubric precedence.

**Architecture:** Canonical criterion signatures select internal assisted detectors. The model extracts grounded facts; pure code chooses N/A and tiers. New or edited criteria retain generic grading. SQLite stores immutable facts alongside original results without changing public DTOs.

**Constraints:** Evaluate operator actions only; retain exact quotes and indices; no real-call external processing; no label changes or conversation-ID shortcuts. Work inline in an isolated worktree.

- [ ] Add shared reference/range validation and three focused fact schemas. Validate role, exact quote, client-facing context and causal order before scoring.
- [ ] Test N/A precedence for 02, all five consultation tiers, dialogue severity precedence, invalid evidence and canonical-versus-edited planning.
- [ ] Integrate helpers after rules/reuse; preserve validated facts and cap pause confidence. Bump prompt and cache versions.
- [ ] Add nullable internal decision_facts storage and an idempotent additive migration. Preserve facts through appeals; test persistence.
- [ ] Run focused tests, typecheck, full tests and build; inspect diff.
- [ ] Run authorized synthetic live variants, full batch and repeat checks; compare facts/grades and report reference-label limitations.
- [ ] Update architecture/rubric/validation docs, open a focused PR for issue #45, self-review and merge after green CI.
