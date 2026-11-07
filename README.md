# CQA hackathon — collaboration and agent starter

**This is a repository instruction and team-handoff pack, not a complete application.** Put its contents at the **root** of the new GitHub repository, preserving `.github/` and the directory layout.

## Human onboarding

1. **Denis:** read [`handoffs/DENIS.md`](handoffs/DENIS.md), create the repository, copy these files to it, and run the first bootstrap prompt with his coding agent. Publish a runnable contracts + mock-data commit first.
2. **Sofia:** read [`handoffs/SOFIA.md`](handoffs/SOFIA.md); after Denis publishes the shared contract/mock, begin frontend work without waiting for a real backend. She owns `apps/web/`.
3. **Eldana:** read [`handoffs/ELDANA.md`](handoffs/ELDANA.md); begin human-labeling and rubric quality-assurance independently. She owns `evaluation/`.

Each handoff names the human's decisions, the agent's bounded responsibilities, the initial issue list, an executable prompt to paste into that person's own coding/research agent, acceptance criteria, and how to hand off completed work.

## Canonical instructions

- [`AGENTS.md`](AGENTS.md): rules for all three agents (Claude Code, Codex or equivalent).
- [`CLAUDE.md`](CLAUDE.md): imports `AGENTS.md` for Claude Code compatibility.
- [`docs/WORKFLOW.md`](docs/WORKFLOW.md): issue, branch, PR, review, unblock and freeze protocol.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): module boundaries and deterministic-first evaluation flow.
- [`docs/INTERFACES.md`](docs/INTERFACES.md): initial shared data types and mock/HTTP API interface; bootstrap must implement it.
- [`docs/RUBRIC.md`](docs/RUBRIC.md): organizer's eight-criterion checklist summary; the original PDF is authoritative.
- [`docs/VALIDATION.md`](docs/VALIDATION.md): human-labeling and model-comparison methodology.

## What not to commit

Never publish the signed organizer API URL, credentials, provided raw conversations, audio URLs, private human-labeling files containing transcript content, or real client data. `.gitignore` is a safeguard, not a substitute for checking `git diff --cached` before committing.

## Primary acceptance test

A previously unseen conversation must be scored by the active checklist; each result must have valid evidence; N/A and weighted totals must be computed by code; reviewer overrides must preserve the original; and changing a criterion through the UI must affect subsequent evaluations without source edits.

## Documentation sources

The shared-agent guidance reflects [Claude Code best practices](https://code.claude.com/docs/en/best-practices), [Claude project instructions](https://code.claude.com/docs/en/memory), and [OpenAI's AGENTS.md guidance](https://developers.openai.com/codex/guides/agents-md), checked 2026-11-07. The official hackathon guide and checklist supplied by the organizers remain the authoritative product/rubric sources.
