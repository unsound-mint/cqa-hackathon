# Operator evaluation correctness implementation plan

Goal: prevent bot credit, stale decisions and unsupported deterministic verdicts.
Architecture: keep the full original transcript; validate attribution at the evaluator boundary. Bind specialized rules to canonical rubric semantics. Persist a versioned cache context and preserve imported conversations.
Tech stack: existing TypeScript, Zod, Fastify and SQLite.

Execute inline; no delegated work.

- [x] Add fictional regression tests in apps/api/test/operator-safety.test.ts for bot-only positive/violation evidence, valid contextual evidence, edited detector instructions, negative verification events and ambiguous disconnections. Run and confirm failures.
- [x] Modify evaluator.ts to require client-facing operator evidence for positive action verdicts and to gate detectors by the canonical criterion signature. Modify facts.ts and closing.ts to abstain on ambiguous event/application claims; update prompts.ts.
- [x] Add cache context in evaluation/reuse.ts, persist via evaluations.ts and db/schema.ts with an idempotent migration in db/index.ts. Pass context and fresh-run behavior through jobs.ts. Add optional force to StartEvaluationInputSchema; preserve existing clients.
- [x] Reject changed re-imports in import/importer.ts rather than rewriting evidence sources. Test unchanged retries and conflicting imports.
- [x] Test reuse after content, prompt, model changes and explicit force; test migration of an existing database. Run API/contracts tests and typechecks, workspace checks/build, inspect the diff, document API and migration behavior.
