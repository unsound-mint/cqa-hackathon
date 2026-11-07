# Required assisted answers implementation plan

Goal: remove the live missing-verification-answer failure without weakening grounding.
Architecture: compile a request-specific strict tool schema from undecided criteria and assisted detectors. Assisted responses use required criterion-id keys; normalize this wire representation for the existing validator. Keep evidence, allowed values, duplicates and code-computed scores authoritative.
Tech stack: existing TypeScript/Zod/Fastify/Anthropic HTTP provider.

Execute inline; no delegated work.
- [ ] Reproduce absent assisted answers and add tests for required per-criterion keys, actual nested detector schema, no-assisted/model-only cases, multiple arbitrary IDs, duplicates and grounding rejection.
- [ ] Add output-schema.ts; update evaluator request/normalization, strict provider tool flag and versioned prompt. Preserve externally stored DTOs.
- [ ] Run focused tests and a small live RU/KZ/EN plus bot-only smoke set before the full batch.
- [ ] Run workspace typecheck/tests/build; inspect diff; document the wire format and retained semantic validation. Rerun 60 synthetic DEV chats, changed criteria and appeals, excluding real calls.
- [ ] Publish a focused PR linked to the issue, verify exact-head CI, merge and report actual live results/cost and residual risks.
