# Reviewed rubric calibration implementation plan

Goal: improve rubric fidelity using explicit official rules and reviewed criterion boundaries, without fitting stored reference labels.
Architecture: versioned fictional calibration examples selected by criterion signature. Generic/edited criteria keep their own instructions. Preserve deterministic scoring and strict evidence checks; expose only relevant timing facts to the original rubric.
Tech stack: existing TypeScript/Zod/Fastify/Haiku provider.

Execute inline; no delegated work.
1. Add tests for semantic example selection, renamed original criteria, edited-criterion exclusion, original-vs-custom timing payloads and output language.
2. Add canonical-rubric helper and calibration examples. Encode correct next steps, prior-context applicability, clarity independent of improper offers, authoritative account disclosure before verification, and resolved-context social closing. Version the prompt.
3. Correct the verification assisted question to separate request applicability from actual disclosure/action. Leave phrase-only social closing to the model's context check.
4. Run focused/workspace checks and inspect the diff. Run fresh fictional variants before replaying the 60 synthetic chats with complete original results retained. Keep real calls and reference labels out of provider requests.
5. Compare rubric agreement and diagnostic stability, distinguish owner-reviewed policy from unadjudicated ChatGPT labels, document results and remaining uncertainty, then publish/merge after CI.
