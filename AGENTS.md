# AGENTS.md

Instructions for AI agents working in this repo. For setup/running/testing, see [README.md](README.md).

## Before making any change

Read these first — they're the source of truth, not restated here:

- `openspec/specs/` — current system behavior (one file per capability).
- `openspec/config.yaml` — tech stack, hard constraints, and engineering conventions (`context` and `operations.apply.guidance` sections). These only get injected into the prompt automatically when using `openspec` CLI commands — if you're working outside that flow, read the file directly.
- `openspec/changes/archive/` — history and reasoning behind past decisions.

## When to use the OpenSpec flow vs. editing directly

- **Changes observable behavior** (anything a `specs/*/spec.md` file would need to describe or update) → propose it first with `/opsx:propose`, then `/opsx:apply`. Don't edit `src/` directly for this.
- **Doesn't change behavior** (docs, typos, comments, pure refactors) → editing directly is fine; no change proposal needed.
