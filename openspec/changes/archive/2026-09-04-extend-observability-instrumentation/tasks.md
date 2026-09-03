Sequencing note: land after `add-agent-skills` and `add-chat-context-history`. Task group 5 attributes input tokens to categories including the agent's instructions and the conversation history; neither exists until those changes land, and writing the attribution first would mean two of its four categories are permanently zero and untested.

## 1. Schema migration

- [x] 1.1 Append a migration to `MIGRATIONS` in `src/stats/migrations.ts` that renames `llm_calls.prompt_tokens` → `input_tokens`, `completion_tokens` → `output_tokens`, `call_index` → `turn_number`, `latency_ms` → `latency`, and adds `timestamp TEXT` (nullable), `agent_id TEXT NOT NULL DEFAULT 'main'`, `cached_tokens INTEGER NOT NULL DEFAULT 0`, `reasoning_tokens INTEGER NOT NULL DEFAULT 0`, `estimated_cost REAL NOT NULL DEFAULT 0`. Do not edit `schema.sql`. Verify: `npx tsc --noEmit` passes.
- [x] 1.2 In the same migration, rename `tool_calls.result_len` → `output_size` and `latency_ms` → `duration`, and add `input_size INTEGER NOT NULL DEFAULT 0` and `output_tokens INTEGER NOT NULL DEFAULT 0`. Verify: `npx tsc --noEmit` passes.
- [x] 1.3 Test in `test/stats/migrations.test.ts` that a fresh database ends at the new version with every renamed and added column present. Verify: `npm test` passes.
- [x] 1.4 Test that a database created at the previous version, populated with rows, retains those rows after migrating, with the old column values readable under the new names. Verify: `npm test` passes.
- [x] 1.5 Test that migrating an already-current database is a no-op and does not duplicate columns. Verify: `npm test` passes.

## 2. Recorder and payloads

- [x] 2.1 Widen `LlmCallStats` and `ToolCallStats` in `src/stats/types.ts` with the new fields, and update `SqliteStatsRecorder`'s prepared inserts in `src/stats/sqlite-recorder.ts` to write them. Verify: `npx tsc --noEmit` passes.
- [x] 2.2 Update `src/stats/reporter.ts`'s queries to the renamed columns. Verify: existing `test/stats/reporter.test.ts` cases pass unchanged in behaviour.
- [x] 2.3 Test that a recorded LLM call stores its own timestamp, and that several calls within one message are orderable by it (covers "Every call carries its own time"). Verify: `npm test` passes.
- [x] 2.4 Test that an LLM call whose provider reports no usage records zero token counts rather than nulls (covers "LLM call without token usage"), and that a call whose provider reports usage records the reported values (covers "LLM call with token usage"). Verify: `npm test` passes.
- [x] 2.5 Test that when no cached or reasoning counts are reported, those columns are zero and the recorder marks them as unreported rather than observed, so a report can honour "Provider reports no cached or reasoning counts". Verify: `npm test` passes.

## 3. Tool-call duration and sizes

- [x] 3.1 In `src/orchestrator.ts`, measure the elapsed time of the sandbox execution and pass it to `recordToolCall`, which currently omits it and so writes zero for every tool. Verify: `npx tsc --noEmit` passes.
- [x] 3.2 Record each tool call's argument size and result size, and the result's size in tokens, using one estimation method applied consistently and documented as an estimate. Verify: `npx tsc --noEmit` passes.
- [x] 3.3 Test with a fake sandbox executor whose two tool calls take materially different times that the recorded durations differ and neither is zero (covers "Duration reflects a slow tool"). Verify: `npm test` passes.
- [x] 3.4 Test that a turn executing several tool calls records one row per call, each with its own duration and sizes, all attributed to that turn (covers "Several tools in one turn" and "Tool call executed"). Verify: `npm test` passes.

## 4. Agent identity and cost

- [x] 4.1 Give each LLM call an agent identity: `main` for the loop, `classifier` for routing, and a per-sub-agent identity assigned in `src/tools/spawn-subagents.ts` so concurrent sub-agents differ. Verify: `npx tsc --noEmit` passes.
- [x] 4.2 Test that a message spawning three concurrent sub-agents produces three distinct agent identities, all attributable to the same task (covers "Concurrent sub-agents are distinguishable"). Verify: `npm test` passes.
- [x] 4.3 Test that a routed message records different agent identities for the classifier call and the main loop's calls (covers "Classifier is distinguishable from the main loop"). Verify: `npm test` passes.
- [x] 4.4 Add a per-model price table read at startup, and a pure function computing an estimated cost from token counts and a price. Unit-test the function directly, including a model absent from the table. Verify: `npm test` passes.
- [x] 4.5 Store the computed cost on the row at record time, and test that changing the price table afterwards leaves previously recorded costs unchanged (covers "Price change does not rewrite history" and "Cost is derived from tokens and price"). Verify: `npm test` passes.
- [x] 4.6 Make an unpriced model identifiable as unpriced rather than free, and test it (covers "Unpriced model is identifiable"). Verify: `npm test` passes.
- [x] 4.7 Document in `.env.example` and `README.md` that with a local provider the prices are those of comparable hosted models, so cost figures are a proxy for spend and not spend itself (see design.md — Decisions). Verify: the documentation states this explicitly.

## 5. Context category attribution

- [x] 5.1 Where the request's message list is assembled, classify each message as the agent's instructions, the user's request, prior conversation, or tool output, and pass the per-category input token shares to the recorder alongside the call. Verify: `npx tsc --noEmit` passes.
- [x] 5.2 Test that for a call containing all four categories, each share is recorded and their total accounts for the call's input tokens (covers "Categories account for the input"). Verify: `npm test` passes.
- [x] 5.3 Test across a multi-turn task that the tool-output share grows while the instruction share does not (covers "Growth of a category is visible across turns"). Verify: `npm test` passes.

## 6. Repeated input measurement

- [x] 6.1 Record, for each LLM call after a task's first, how much of its input was already sent in an earlier call of that task and how much is new, computed by the system rather than read from the provider. Verify: `npx tsc --noEmit` passes.
- [x] 6.2 Test that a second turn resending the first turn's conversation plus new tool output records the resent portion as repeated and only the new output as new (covers "Later turn repeats earlier content"). Verify: `npm test` passes.
- [x] 6.3 Test that a task's first call records no repeated input (covers "First call of a task"). Verify: `npm test` passes.
- [x] 6.4 Test that two separate messages with similar content each record no repeated input on their first call (covers "Repetition is measured per task"). Verify: `npm test` passes.
- [x] 6.5 Confirm the added measurements cannot fail a message: force the attribution and repetition computations to throw and assert the message is still handled and replied to (see design.md — Risks). Verify: `npm test` passes.

## 7. Final verification

- [x] 7.1 Run `npm test` and `npx tsc --noEmit`; both must pass with no new failures. Verify: `npm test` exits 0 and `tsc` reports no errors.
- [x] 7.2 Run the bot against a real message that uses at least one tool, then inspect `data/stats.db` and confirm every new column holds a plausible value — in particular that tool durations are non-zero and the category shares sum to the call's input tokens. Verify: a manual query over the recorded rows shows no placeholder values.
