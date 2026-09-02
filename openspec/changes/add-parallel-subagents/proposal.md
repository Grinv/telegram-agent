## Why

After changes 1–3, the bot can run a think → act → observe loop, record stats, and route messages to the right model. But when a task has independent sub-parts (e.g. "analyze all 3 CSV files and summarize"), the LLM can only process them sequentially — one loop, one sandbox, one sub-task at a time. Parallel subagents let the LLM spawn N independent loops that run concurrently (each with its own sandbox), collecting results in a fraction of the time. Because `runLoop` was extracted as a standalone function (change 1) and `ToolContext` is extensible (change 1), subagents are implementable as a tool — the orchestrator itself does not change.

## What Changes

- Extend `ToolContext` (from change 1) with optional fields: `callLlm`, `sandboxExecutor`, `toolRegistry`, `runLoop`, and `router?`. Existing tools (change 1: `execute_command`, `read_file`, `write_file`, `list_files`) use only `execInContainer` and are unaffected by the new fields.
- Add a `spawn_subagent` tool that takes a task description and an optional model, starts a nested `runLoop` with a fresh sandbox, and returns the sub-agent's final answer. The sub-agent inherits the tool registry (or a subset), so it can use tools too.
- Add a `spawn_subagents` tool that takes an array of task descriptions and an optional model, starts N `runLoop` calls in parallel via `Promise.all` (each with its own fresh sandbox), and returns all results.
- Each sub-agent LLM call is recorded in stats with `role="subagent"` (the stats hook points and `role` field already exist from changes 1 and 2). Sub-agent tool calls are recorded under the parent message, linked via `message_id`.
- The orchestrator is **not modified** — `spawn_subagent` and `spawn_subagents` are registered as tools in the `ToolRegistry`, and the LLM calls them like any other tool. The `runLoop` function is called recursively inside the tool handler.

## Capabilities

### New Capabilities
- `subagents`: Parallel sub-agent execution via `spawn_subagent`/`spawn_subagents` tools — each sub-agent runs an independent think → act → observe loop with its own sandbox, enabling concurrent task decomposition and faster parallel processing.

### Modified Capabilities
- `sandbox-execution`: `ToolContext` is extended with `callLlm`, `sandboxExecutor`, `toolRegistry`, `runLoop`, and `router?` so the `spawn_subagent` tool can start nested loops. Existing tools are unaffected (they ignore the new fields).

## Impact

- Modified: `src/tools/types.ts` — `ToolContext` extended with optional `callLlm?`, `sandboxExecutor?`, `toolRegistry?`, `runLoop?`, `router?`.
- New: `src/tools/spawn-subagent.ts` — `spawn_subagent` tool implementation. Uses `context.runLoop` and `context.sandboxExecutor` to run a nested loop.
- New: `src/tools/spawn-subagents.ts` — `spawn_subagents` tool implementation. Uses `Promise.all` over `spawn_subagent` calls.
- Modified: `src/tools/index.ts` — `createDefaultToolRegistry()` now also registers `spawn_subagent` and `spawn_subagents`. A new factory `createToolRegistry(deps)` accepts a `ToolContext` (or partial context) to register the subagent tools only when the required context fields are present.
- `src/orchestrator.ts`: **not modified**. The orchestrator already calls tools from the registry; subagent tools are just tools.
- `src/index.ts`: wires the extended `ToolContext` (with `callLlm`, `sandboxExecutor`, `toolRegistry`, `runLoop`) into the tool registry.
- Stats: sub-agent LLM calls recorded with `role="subagent"` (change 2's schema already has the `role` column; no schema change needed).
- `.env.example` / `README.md`: document `MAX_SUBAGENTS` (default 3) env var limiting concurrent subagents.
- Tests: new `test/tools/spawn-subagent.test.ts` (fake `runLoop` + fake `callLlm`) and `spawn-subagents.test.ts` (fake `Promise.all` over fake `runLoop`).
