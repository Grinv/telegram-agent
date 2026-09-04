## Why

The two measurements built to find where the agent's tokens go both ignore the largest thing it sends.

`categorizeInputTokens` (`src/stats/context-categories.ts`) divides the provider-reported input-token total across four message categories in proportion to each category's share of the message text. Tool definitions are not messages — they travel in `LlmRequest.tools` (`src/llm/types.ts`), which the Ollama connector sends as the request's separate `tools` array (`src/llms/ollama/index.ts`). Their tokens are missing from the proportions but present in the total, so they are spread silently across the four message categories rather than attributed to themselves.

`measureRepeatedInput` (`src/stats/repeated-input.ts`) compares two message lists and reports their shared prefix as the repeated portion. Tool definitions are not in those lists either, so the block resent byte-for-byte on every single call is never counted as repetition at all.

This is a defect, not a presentation choice, and the existing spec already says so. The `agent-stats` requirement *Input tokens are attributed to content categories* carries the scenario *Growth of a category is visible across turns*, which states that across turns the tool-output share grows "while the instruction share does not". In the frozen benchmark baseline (`data/benchmark-stats.db`, task set `7d533a54`, model `qwen2.5`, 70 LLM calls, 48,845 input tokens) the recorded instruction share grows from an average of 406 tokens at turn 0 to 478 at turn 1 — while the system instruction text is byte-identical between those turns. The implementation violates a scenario it is supposed to satisfy.

Two further measurements show the scale:

- `capital-of-france` reports 707 input tokens, recorded as 624 instruction and 83 user request. Measured directly, its system instruction is ~60 estimated tokens and its user prompt ~8 — a ratio of 88:12, exactly the 624:83 that was recorded. The task's real user request is about 8 tokens, not the ~190 the recorded average implies.
- The seven advertised tool definitions serialise to ~542 estimated tokens (`spawn_subagent` 104, `spawn_subagents` 100, `write_file` 83, `read_skill` 70, `execute_command` 67, `list_files` 60, `read_file` 59), against a system instruction of ~60. About 600 of every call's ~700 input tokens — roughly 85% — is content neither measurement attributes correctly.

The consequence is that a reader of these views concludes the agent's cost is instructions and user requests, when it is overwhelmingly a constant block resent on every call. The reported 31.7% repeated input understates the truth badly for the same reason.

## What Changes

- Tool definitions are measured. Their tokens are attributed to **a content category of their own** rather than folded into the agent's instructions, because the two are separately actionable: the instruction text is authored and edited by hand, while the schemas are generated from the registered tools. At roughly 542 tokens against 60, a category that merged them would hide a ninefold difference behind one number.
- Repeated-input measurement counts the tool-definition block, so the figure reflects what the model has actually already seen rather than only what the message list repeated.
- Repetition **stays scoped to a single task**, as the existing requirement states. The constant block therefore counts as new on a task's first call and repeated on every call after it. Widening the scope to the whole process was rejected: it would make the measurement depend on how many tasks the process had already handled, so two runs of the same benchmark task would report different repetition, and the benchmark's comparability is worth more than the extra few points the wider scope would report. The block's absolute size stays visible in its own category, so nothing is lost.
- The orchestrator passes the request's tool definitions into the measurement. They are already in scope at the call site in `runLoop` (`src/orchestrator.ts`) and are simply not passed today.
- Rows recorded before this change carry figures computed the old way. They are marked, and views report aggregates over them as partial rather than averaging old and new attributions together as though they were the same measurement.

## Capabilities

### Modified Capabilities

- `agent-stats`: the content categories a call's input is divided into gain a category for tool definitions, and the requirement that the categories account for the whole input now means the whole input rather than the message portion of it. The repeated-input requirement gains the tool-definition block. The requirement that unavailable figures are reported as unavailable extends to rows recorded under the previous attribution.

## Impact

- `src/stats/context-categories.ts` — a fifth category; the split covers content sent outside the message list.
- `src/stats/repeated-input.ts` — the constant block participates in the repeated/new division.
- `src/stats/types.ts`, `src/stats/sqlite-recorder.ts`, `src/stats/migrations.ts` — one new recorded field and a schema migration for it, plus the marker distinguishing rows recorded under the old attribution.
- `src/stats/dashboard-views.ts`, `src/stats/dashboard-queries.ts` — the analysis view renders the new category and reports pre-change rows as partial.
- `src/orchestrator.ts` — `measureContextStats` receives the tool definitions.
- `benchmark/` — no change. `benchmark/runner.ts` reads tokens, cost, turns and tool calls, not the category or repeated-input columns, so the frozen baseline stays valid. That this holds is verified rather than assumed.
- **Sequencing**: land second — after `adopt-standard-observability`, before `add-token-optimizations`. The observability change is additive and does not depend on these figures being correct, so it can precede this one; the optimization change justifies which optimizations it keeps by exactly these figures, so it must not.

## Non-goals

- Changing what the agent sends. This change measures the tool-definition block correctly; it does not shrink it.
- Changing the benchmark task set or its baseline snapshot.
- Recomputing historical rows. The old figures were computed from data the database does not retain, so they cannot be corrected after the fact — only marked.
