# Spec cost history

Auto-populated by `scripts/spec-usage.mjs finish` when archiving a change.
Tokens and time are read from local logs for the period between
`/opsx:propose` and archivation, merged across whichever engine(s) did the
work: the opencode SQLite database, and Claude Code's JSONL session
transcripts. "Model time" is the sum of `time.completed - time.created` per
assistant message — only generation, excluding tool execution and pauses
between user turns; Claude Code doesn't log this, so a report is marked as a
lower bound whenever Claude Code turns are included. Parallel sub-agent time
is summed. "Total" is the sum of all token types, including cache read and
write.

## 2026-09-02 — add-docker-sandboxed-tool-use

Implemented Docker deployment, new tool/sandbox tests, docs, and final verification for the tool-use sandbox change; archived with specs synced to bot-orchestrator, llm-inference, docker-deployment, sandbox-execution.

- Time: 21h 31m total, model time 15m 11s, 2026-09-01 19:07 → 2026-09-02 16:39
- glm-5.2: 80 requests, 15m 11s, in 200 651 / out 34 331 (reasoning 20 620) / cache write 0 / cache read 5 453 376
- Total: 5 688 358 tokens
- Start: from change file creation time

## 2026-09-02 — fix-unknown-tool-call-handling

Fixed unhandled ToolNotFoundError crashing the tool-use loop when the LLM hallucinates a tool name; now returns a structured failure observation fed back to the LLM. Archived with sandbox-execution spec synced.

- Time: 29m 24s total, model time 0s (lower bound — Claude Code turns are not included; its logs don't record per-message duration), 2026-09-02 17:29 → 2026-09-02 17:58
- claude-sonnet-5: 123 requests, duration n/a, in 246 / out 82 585 (reasoning 27 553) / cache write 155 622 / cache read 35 496 491
- Total: 35 734 944 tokens
- Start: from change file creation time

## 2026-09-02 — add-sqlite-stats

Implemented SQLite-backed stats recording and Markdown reporting; archived and synced agent-stats spec.

- Time: 18h 44m total, model time 15m 11s (lower bound — Claude Code turns are not included; its logs don't record per-message duration), 2026-09-01 23:46 → 2026-09-02 18:30
- claude-sonnet-5: 373 requests, duration n/a, in 746 / out 238 781 (reasoning 83 160) / cache write 519 966 / cache read 71 103 411
- glm-5.2: 80 requests, 15m 11s, in 200 651 / out 34 331 (reasoning 20 620) / cache write 0 / cache read 5 453 376
- Total: 77 551 262 tokens
- Start: from change file creation time

## 2026-09-02 — fix-stats-unhandled-exception-gap

Closed the gap where handleMessage's catch block never called statsRecorder.recordMessage on an unexpected error, leaving the DB row stuck at insert values.

- Time: 16m 37s total, model time 0s (lower bound — Claude Code turns are not included; its logs don't record per-message duration), 2026-09-02 18:22 → 2026-09-02 18:39
- claude-sonnet-5: 81 requests, duration n/a, in 162 / out 41 542 (reasoning 15 072) / cache write 160 261 / cache read 12 709 854
- Total: 12 911 819 tokens
- Start: from change file creation time

## 2026-09-02 — add-stats-db-migrations

Added versioned SQLite migrations (PRAGMA user_version) for the stats database, wired into both the recorder and reporter, preserving existing rows across schema changes.

- Time: 26m 42s total, model time 0s (lower bound — Claude Code turns are not included; its logs don't record per-message duration), 2026-09-02 18:24 → 2026-09-02 18:51
- claude-sonnet-5: 148 requests, duration n/a, in 296 / out 62 134 (reasoning 15 719) / cache write 254 502 / cache read 17 345 018
- Total: 17 661 950 tokens
- Start: from change file creation time
