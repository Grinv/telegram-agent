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

## 2026-09-02 — add-classifier-routing

Added dynamic Ollama model discovery, LLM-based classifier routing with auto-selected classifier/fallback models, think:false + robust response matching for the classifier, per-role stats recording with latency, and verified the full pipeline end-to-end against a real Ollama instance and live Telegram bot.

- Time: 20h 25m total, model time 15m 11s (lower bound — Claude Code turns are not included; its logs don't record per-message duration), 2026-09-01 23:48 → 2026-09-02 20:13
- claude-sonnet-5: 821 requests, duration n/a, in 1 642 / out 463 693 (reasoning 157 165) / cache write 1 150 578 / cache read 165 452 726
- glm-5.2: 80 requests, 15m 11s, in 200 651 / out 34 331 (reasoning 20 620) / cache write 0 / cache read 5 453 376
- Total: 172 756 997 tokens
- Start: from change file creation time

## 2026-09-02 — add-parallel-subagents

Added spawn_subagent/spawn_subagents tools that run nested think -> act -> observe loops, each with its own sandbox, in batches of MAX_SUBAGENTS; synced the sandbox-execution spec and added the new subagents capability. Backfilled after the fact — `finish` was never run at archive time.

- Time: 3h 19m total, model time 0s (lower bound — Claude Code turns are not included; its logs don't record per-message duration), 2026-09-02 18:52 → 2026-09-02 22:11
- claude-sonnet-5: 481 requests, duration n/a, in 962 / out 294 971 (reasoning 103 708) / cache write 952 349 / cache read 110 113 753
- claude-opus-5: 25 requests, duration n/a, in 50 / out 8 080 (reasoning 1 683) / cache write 94 329 / cache read 1 657 668
- <synthetic>: 2 requests, duration n/a, in 0 / out 0 / cache write 0 / cache read 0
- Total: 113 122 162 tokens
- Start: specified manually

## 2026-09-03 — add-microvm-isolation (+ fix-ollama-message-mapping)

Ran the agent inside a Docker Sandboxes microVM: default-deny egress, three granted host directories, two granted host ports, and the Telegram token held by a host-side broker because sbx substitutes secrets into headers while Telegram authenticates by URL path. Verifying the live tool-call path exposed a second defect and pulled fix-ollama-message-mapping into the same session: the Ollama connector sent tool definitions flat, so every tool call came back with an empty name and the act step was never reached in any deployment. One combined entry covers both changes — they were implemented in one unsplittable window, and two entries would double-count the shared tokens.

- Time: 4h 3m total, model time 0s (lower bound — Claude Code turns are not included; its logs don't record per-message duration), 2026-09-03 00:03 → 2026-09-03 04:06
- claude-opus-5: 249 requests, duration n/a, in 498 / out 195 172 (reasoning 71 952) / cache write 696 443 / cache read 47 036 166
- <synthetic>: 1 requests, duration n/a, in 0 / out 0 / cache write 0 / cache read 0
- Total: 47 928 279 tokens
- Start: specified manually

## 2026-09-03 — fix-telegram-message-limit

Split over-long Telegram replies into ordered parts within the 4096-char limit, and finalize per-message stats only after delivery succeeds, recording delivery failures with a distinct DELIVERY_FAILED reason.

- Time: 6h 7m total, model time 0s (lower bound — Claude Code turns are not included; its logs don't record per-message duration), 2026-09-02 22:28 → 2026-09-03 04:35
- claude-opus-5: 390 requests, duration n/a, in 780 / out 366 154 (reasoning 121 530) / cache write 964 023 / cache read 84 259 323
- claude-sonnet-5: 88 requests, duration n/a, in 176 / out 58 646 (reasoning 29 675) / cache write 183 226 / cache read 10 975 289
- <synthetic>: 1 requests, duration n/a, in 0 / out 0 / cache write 0 / cache read 0
- Total: 96 807 617 tokens
- Start: from change file creation time

## 2026-09-03 — add-sandbox-egress

Added configurable sandbox network isolation (isolated default / egress opt-in) with a dedicated Docker network, curl in the sandbox image, and manual verification against a live bot.

- Time: 20h 33m total, model time 0s (lower bound — Claude Code turns are not included; its logs don't record per-message duration), 2026-09-02 22:31 → 2026-09-03 19:05
- claude-opus-5: 381 requests, duration n/a, in 762 / out 353 111 (reasoning 116 854) / cache write 950 647 / cache read 82 884 289
- claude-sonnet-5: 235 requests, duration n/a, in 470 / out 128 784 (reasoning 55 704) / cache write 532 883 / cache read 30 989 278
- <synthetic>: 1 requests, duration n/a, in 0 / out 0 / cache write 0 / cache read 0
- Total: 115 840 224 tokens
- Start: from change file creation time

## 2026-09-03 — add-agent-skills

Added an agent-skills capability: Markdown skill files loaded at startup, advertised as a name/description index in a new system message on every request, retrieved on demand via a read_skill tool; shipped weather and morning-briefing skills, verified end-to-end against a live Ollama model.

- Time: 24h 22m total, model time 0s (lower bound — Claude Code turns are not included; its logs don't record per-message duration), 2026-09-02 22:35 → 2026-09-03 22:57
- claude-opus-5: 373 requests, duration n/a, in 746 / out 339 313 (reasoning 112 542) / cache write 936 558 / cache read 81 547 081
- claude-sonnet-5: 622 requests, duration n/a, in 1 244 / out 317 604 (reasoning 134 423) / cache write 1 015 685 / cache read 133 156 276
- <synthetic>: 1 requests, duration n/a, in 0 / out 0 / cache write 0 / cache read 0
- Total: 217 314 507 tokens
- Start: from change file creation time

## 2026-09-03 — fix-ollama-fetch-timeout

Added undici as a scoped dependency to raise fetch's dispatcher timeouts in the inference-runner child process, fixing the silent ~300s cap on LLM_TIMEOUT_MS; synced the llm-inference spec with the new effective-timeout guarantee.

- Time: 27m 45s total, model time 0s (lower bound — Claude Code turns are not included; its logs don't record per-message duration), 2026-09-03 22:38 → 2026-09-03 23:06
- claude-sonnet-5: 99 requests, duration n/a, in 198 / out 49 618 (reasoning 15 057) / cache write 187 504 / cache read 22 265 329
- Total: 22 502 649 tokens
- Start: from change file creation time

## 2026-09-04 — add-chat-context-history

Persist per-chat conversation history in SQLite (sender-attributed turns, /new to reset), thread it into the LLM request, expose Telegram sender identity, and verify end-to-end on a live bot deployment.

- Time: 27h 51m total, model time 0s (lower bound — Claude Code turns are not included; its logs don't record per-message duration), 2026-09-02 20:20 → 2026-09-04 00:11
- claude-sonnet-5: 1 042 requests, duration n/a, in 2 084 / out 575 116 (reasoning 232 933) / cache write 1 995 825 / cache read 201 263 896
- claude-opus-5: 433 requests, duration n/a, in 866 / out 413 268 (reasoning 144 248) / cache write 1 102 119 / cache read 88 165 651
- <synthetic>: 3 requests, duration n/a, in 0 / out 0 / cache write 0 / cache read 0
- Total: 293 518 825 tokens
- Start: from change file creation time

## 2026-09-04 — fix-empty-llm-response

Classify an empty (or whitespace-only) LLM response with no tool call as a loop failure (EMPTY_RESPONSE) instead of sending an empty Telegram message; verified with unit tests and a live qwen3:1.7b/Ollama reproduction.

- Time: 29m 12s total, model time 0s (lower bound — Claude Code turns are not included; its logs don't record per-message duration), 2026-09-04 00:05 → 2026-09-04 00:35
- claude-sonnet-5: 110 requests, duration n/a, in 220 / out 49 205 (reasoning 12 545) / cache write 193 758 / cache read 18 351 404
- Total: 18 594 587 tokens
- Start: from change file creation time

## 2026-09-04 — extend-observability-instrumentation

Extended agent-stats instrumentation with real tool-call durations/sizes, per-call agent identity, estimated cost, content-category attribution, and repeated-input measurement, plus a schema migration and live verification against a real Telegram message.

- Time: 25h 26m total, model time 0s (lower bound — Claude Code turns are not included; its logs don't record per-message duration), 2026-09-02 23:46 → 2026-09-04 01:13
- claude-sonnet-5: 1 182 requests, duration n/a, in 2 364 / out 636 163 (reasoning 260 529) / cache write 2 018 018 / cache read 231 477 617
- claude-opus-5: 293 requests, duration n/a, in 586 / out 243 709 (reasoning 77 420) / cache write 824 059 / cache read 62 464 336
- <synthetic>: 1 requests, duration n/a, in 0 / out 0 / cache write 0 / cache read 0
- Total: 297 666 852 tokens
- Start: from change file creation time

## 2026-09-04 — add-observability-dashboard

Implemented three read-only stats dashboard views (summary, timeline, analysis) over the existing SQLite stats DB, verified against real bot data, and synced the delta spec into agent-stats.

- Time: 25h 59m total, model time 0s (lower bound — Claude Code turns are not included; its logs don't record per-message duration), 2026-09-02 23:49 → 2026-09-04 01:49
- claude-sonnet-5: 1 291 requests, duration n/a, in 2 582 / out 725 879 (reasoning 301 389) / cache write 2 245 787 / cache read 249 526 075
- claude-opus-5: 287 requests, duration n/a, in 574 / out 233 436 (reasoning 77 252) / cache write 811 800 / cache read 60 644 964
- <synthetic>: 1 requests, duration n/a, in 0 / out 0 / cache write 0 / cache read 0
- Total: 314 191 097 tokens
- Start: from change file creation time

## 2026-09-04 — add-agent-benchmark

Implemented the agent benchmark (fixed task set, repeatable runner, snapshots, comparison, sampling controls in llm-inference) and recorded/verified the baseline against qwen2.5 via a Docker Compose service.

- Time: 29h 12m total, model time 0s (lower bound — Claude Code turns are not included; its logs don't record per-message duration), 2026-09-02 23:51 → 2026-09-04 05:03
- claude-sonnet-5: 1 524 requests, duration n/a, in 3 048 / out 956 560 (reasoning 430 203) / cache write 2 939 807 / cache read 315 917 512
- claude-opus-5: 283 requests, duration n/a, in 566 / out 227 362 (reasoning 76 420) / cache write 806 151 / cache read 59 397 145
- <synthetic>: 2 requests, duration n/a, in 0 / out 0 / cache write 0 / cache read 0
- Total: 380 248 151 tokens
- Start: from change file creation time

## 2026-09-04 — planning session (three changes, none archived)

Planning-only session: read the frozen baseline and recorded its four figures; found and measured that `categorizeInputTokens` and `measureRepeatedInput` both ignore tool definitions (~542 of every call's ~700 input tokens), which understates repeated input as 31.7%; measured against the running Ollama that `prompt_eval_count` reports the full prompt even on a byte-identical repeat, so no cache hit rate is obtainable on this provider. Created `fix-context-attribution` and `adopt-standard-observability`, and extended `add-token-optimizations` with RTK shell-output compression and three redundancy-only reductions of the constant request block (~32% estimated). No code was written and nothing was archived.

- Time: 1h 53m total, model time 0s (lower bound — Claude Code turns are not included; its logs don't record per-message duration), 2026-09-04 07:04 → 2026-09-04 08:58
- claude-opus-5: 160 requests, duration n/a, in 320 / out 168 422 (reasoning 60 002) / cache write 321 387 / cache read 29 299 423
- <synthetic>: 1 requests, duration n/a, in 0 / out 0 / cache write 0 / cache read 0
- Total: 29 789 552 tokens
- Start: from session transcript start (no `/opsx:propose` marker — the proposals were launched from within the session, which the `UserPromptSubmit` hook does not see)
- Split by window, boundaries at each change's first mention, approximate because the work interleaved:
  - 07:04 → 07:45 (41m, 73 requests): baseline reading, attribution defect, Ollama cache experiment — 7 882 751 tokens
  - 07:45 → 08:41 (55m, 49 requests): `adopt-standard-observability`, RTK/RLM evaluation, RTK folded into `add-token-optimizations` — 10 501 951 tokens
  - 08:41 → 08:58 (17m, 38 requests): `fix-context-attribution`, sequencing, price table, three conservative reductions — 11 189 474 tokens

## 2026-09-04 — fix-context-attribution

Attributed tool definitions to their own content category and repeated-input bucket, added a schema migration marking the attribution version, updated dashboard views/queries, verified against a live benchmark re-run, and synced the agent-stats spec.

- Time: 37m 30s total, model time 0s (lower bound — Claude Code turns are not included; its logs don't record per-message duration), 2026-09-04 20:15 → 2026-09-04 20:52
- claude-sonnet-5: 122 requests, duration n/a, in 243 / out 97 167 (reasoning 38 744) / cache write 275 425 / cache read 22 380 518
- claude-opus-5: 5 requests, duration n/a, in 10 / out 3 802 (reasoning 1 597) / cache write 5 647 / cache read 1 871 145
- Total: 24 633 957 tokens
- Start: from /opsx:propose marker

## 2026-09-05 — adopt-standard-observability

Adopted OpenTelemetry trace export (opt-in via OTEL_EXPORTER_OTLP_ENDPOINT) alongside the existing local SQLite stats recorder, with no change to default behavior or the benchmark baseline.

- Time: 9h 46m total, model time 0s (lower bound — Claude Code turns are not included; its logs don't record per-message duration), 2026-09-04 15:45 → 2026-09-05 01:32
- claude-sonnet-5: 344 requests, duration n/a, in 687 / out 242 094 (reasoning 103 284) / cache write 878 437 / cache read 68 669 194
- claude-opus-5: 127 requests, duration n/a, in 254 / out 128 782 (reasoning 37 912) / cache write 532 007 / cache read 35 276 792
- <synthetic>: 3 requests, duration n/a, in 0 / out 0 / cache write 0 / cache read 0
- Total: 105 728 247 tokens
- Start: from change file creation time
