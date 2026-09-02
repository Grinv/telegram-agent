## 1. ToolContext Extension

- [ ] 1.1 Update `src/tools/types.ts` `ToolContext` interface to add optional fields: `callLlm?: CallLlm`, `sandboxExecutor?: { execute(toolCalls, registry): Promise<ToolResult[]> }`, `toolRegistry?: ToolRegistry`, `runLoop?: typeof runLoop`, `router?: Router`, `statsRecorder?: StatsRecorder`, `maxSubIterations?: number`, `maxSubagents?: number`. Import the needed types from `src/llm/types.ts`, `src/stats/types.ts`, `src/routing/types.ts`. Existing tools ignore these fields. Verify: `tsc --noEmit` passes.

## 2. ToolRegistry.without()

- [ ] 2.1 Add a `without(names: string[]): ToolRegistry` method to `src/tools/registry.ts` that returns a new `ToolRegistry` excluding the named tools. Shallow copy of the internal map (tools are not deep-cloned). Verify: `tsc --noEmit` passes.
- [ ] 2.2 Unit test `without()`: register 4 tools, call `without(["a", "b"])`, assert the returned registry has 2 tools and `getTool("a")` throws. Verify: `npm test` passes.
- [ ] 2.3 Unit test `without()` returns a registry that still reports `isEmpty()=false` when at least one tool remains, and `isEmpty()=true` when all are excluded. Verify: `npm test` passes.

## 3. spawn_subagent Tool

- [ ] 3.1 Create `src/tools/spawn-subagent.ts` — the `spawn_subagent` tool. Handler checks that `context.runLoop`, `context.toolRegistry`, and `context.callLlm` are present (returns `{ ok: false, error: "..." }` if not). Builds a sub-registry via `context.toolRegistry.without(["spawn_subagent", "spawn_subagents"])`. Calls `context.runLoop(messages, tools, { callLlm, sandboxExecutor, toolRegistry: subRegistry, statsRecorder, maxIterations: context.maxSubIterations ?? 3, model: args.model, role: "subagent" })`. Returns the loop's result text or error. Verify: `tsc --noEmit` passes.
- [ ] 3.2 Unit test `spawn_subagent` with a fake `runLoop` (returns `{ ok: true, text: "sub-agent answer" }`) and a fake `ToolRegistry`: assert the tool returns `{ ok: true, output: "sub-agent answer" }`, and that the sub-registry passed to `runLoop` excludes spawn tools. Verify: `npm test` passes.
- [ ] 3.3 Unit test `spawn_subagent` with a fake `runLoop` returning `{ ok: false, reason: "MAX_ITERATIONS" }`: assert the tool returns `{ ok: false, error: "MAX_ITERATIONS" }`. Verify: `npm test` passes.
- [ ] 3.4 Unit test `spawn_subagent` when `context.runLoop` is undefined: assert it returns `{ ok: false, error: "..." }` without throwing. Verify: `npm test` passes.
- [ ] 3.5 Unit test `spawn_subagent` passes `args.model` through to `runLoop` deps when provided, and omits it (undefined) when not provided. Verify: `npm test` passes.

## 4. spawn_subagents Tool

- [ ] 4.1 Create `src/tools/spawn-subagents.ts` — the `spawn_subagents` tool. Handler reads `context.maxSubagents ?? 3`. Processes `args.tasks` in batches of `maxSubagents` using `Promise.all` over `spawnSubagentTool.execute(context, { task, model })`. Collects results (success → output string, failure → `[failed: reason]`), joins them as a JSON array string. Verify: `tsc --noEmit` passes.
- [ ] 4.2 Unit test `spawn_subagents` with 3 tasks and `maxSubagents=3` (fake `runLoop`): assert all 3 run in parallel (all `runLoop` calls start before any completes — can verify with a spy that records call order/timing), results are collected in order. Verify: `npm test` passes.
- [ ] 4.3 Unit test `spawn_subagents` with 7 tasks and `maxSubagents=3`: assert exactly 3 `runLoop` calls are in-flight at any time (batching). Verify: `npm test` passes.
- [ ] 4.4 Unit test `spawn_subagents` where one sub-agent fails and two succeed: assert the result array contains 2 outputs and 1 `[failed: ...]` entry, and `ok` is true (the tool itself succeeds — individual failures are noted in the result). Verify: `npm test` passes.

## 5. Registry & Wiring

- [ ] 5.1 Update `src/tools/index.ts` to export `spawnSubagentTool` and `spawnSubagentsTool`. Add a `createSubagentToolRegistry(context: ToolContext): ToolRegistry` factory that registers all tools (including spawn tools) only when `context.runLoop` and `context.callLlm` are present; otherwise registers only the base 4 tools (no spawn tools). This lets the same code path work before and after this change. Verify: `tsc --noEmit` passes.
- [ ] 5.2 Update `src/index.ts` to construct the full `ToolContext` (with `callLlm`, `sandboxExecutor`, `toolRegistry`, `runLoop`, `statsRecorder`, `router`, `maxSubagents`) and pass it to `createSubagentToolRegistry`. Register the spawn tools when the required context fields are present. Verify: `tsc --noEmit` passes.
- [ ] 5.3 Update `src/config.ts` to add `maxSubagents` (env `MAX_SUBAGENTS`, default 3) and `maxSubIterations` (env `MAX_SUB_ITERATIONS`, default 3). Add pure resolver functions and unit test them. Verify: config tests pass.

## 6. Orchestrator (no changes needed — verify)

- [ ] 6.1 Confirm `src/orchestrator.ts` is not modified by this change — the orchestrator already calls tools from the registry and feeds results back. The `spawn_subagent` tool is just another tool. Verify: `git diff src/orchestrator.ts` shows no changes. If changes are needed, document why.

## 7. Stats Integration

- [ ] 7.1 Verify that `runLoop` (from change 1) passes the `role` field from its deps to `statsRecorder?.recordLlmCall()`. If `role` is not yet a dep of `runLoop`, add it as an optional `role?: string` (default `"main"`). Verify: `tsc --noEmit` passes.
- [ ] 7.2 Unit test: `runLoop` called with `role: "subagent"` calls `statsRecorder.recordLlmCall` with `role: "subagent"` in the stats payload. Verify: `npm test` passes.

## 8. Documentation

- [ ] 8.1 Update `.env.example` with `MAX_SUBAGENTS` (default 3) and `MAX_SUB_ITERATIONS` (default 3). Verify: file contains all new vars.
- [ ] 8.2 Update `README.md` — add a "Parallel Subagents" section documenting: the `spawn_subagent`/`spawn_subagents` tools, the recursion guard, the `MAX_SUBAGENTS` limit, how sub-agent stats appear (`role="subagent"`), and an example of when the LLM might use them. Verify: README reflects the new functionality.

## 9. Final Verification

- [ ] 9.1 Run `npm test` and confirm all tests pass. Verify: `npm test` exits 0.
- [ ] 9.2 Run `tsc --noEmit`. Verify: no type errors.
