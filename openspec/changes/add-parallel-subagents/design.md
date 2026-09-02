## Context

See proposal.md — Why. After changes 1–3:
- `runLoop` is a standalone function extracted from `createMessageHandler` (change 1).
- `ToolContext = { execInContainer }` — extensible by design (change 1).
- `DockerSandboxExecutor.execute()` is stateless — it creates a sandbox, runs tools, tears down, returns. Multiple concurrent calls each get their own container (change 1).
- Stats records `role` per LLM call; `role="subagent"` is a new value for this change (change 2 schema already supports it).
- `LlmRequest.model?` lets a sub-agent use a specific model (change 1 + change 3's routing).

This change adds two tools (`spawn_subagent`, `spawn_subagents`) that call `runLoop` recursively. The orchestrator is not modified — these are just tools in the registry.

## Goals / Non-Goals

**Goals:**
- Let the LLM decompose a task and process independent parts in parallel.
- Each sub-agent gets its own sandbox (isolation) and its own loop (independent LLM context).
- Recursion guard: sub-agents cannot spawn sub-agents.
- Concurrency limit: `MAX_SUBAGENTS` caps parallel sandboxes.
- Stats: sub-agent calls recorded with `role="subagent"`.

**Non-Goals:**
- Modifying the orchestrator — subagents are tools, not an orchestrator feature.
- Inter-subagent communication — sub-agents are independent; they don't share state or message each other. The parent LLM coordinates by collecting results.
- Sub-agent persistence — a sub-agent's sandbox is torn down when its loop ends, just like any tool call.
- Custom tool subsets per sub-agent — all sub-agents get the same registry (minus spawn tools). Selective tool access can be added later if needed.

## Decisions

### 1. `ToolContext` extension: optional fields

```typescript
interface ToolContext {
  execInContainer: (command: string) => Promise<{ stdout: string, stderr: string, exitCode: number }>

  // Added by this change (all optional — existing tools ignore them):
  callLlm?: CallLlm
  sandboxExecutor?: { execute(toolCalls, registry): Promise<ToolResult[]> }
  toolRegistry?: ToolRegistry
  runLoop?: typeof runLoop
  router?: Router
  statsRecorder?: StatsRecorder
}
```

The `spawn_subagent` tool checks that `runLoop`, `sandboxExecutor`, `toolRegistry`, and `callLlm` are present in the context. If any is missing, it returns an error (the tool should not have been registered without them). `router` and `statsRecorder` are optional — a sub-agent can run without routing or stats.

- Alternative considered: a separate `SubagentContext` type — rejected; `ToolContext` is already designed to be extensible (change 1 spec), and a separate type would force the orchestrator to construct two contexts.

### 2. `spawn_subagent` implementation

```typescript
// src/tools/spawn-subagent.ts
export const spawnSubagentTool: Tool = {
  name: "spawn_subagent",
  description: "Spawn a sub-agent to handle an independent sub-task. The sub-agent runs its own think-act-observe loop with a fresh sandbox.",
  parameters: {
    type: "object",
    properties: {
      task: { type: "string", description: "The task description for the sub-agent" },
      model: { type: "string", description: "Model to use (optional, uses classifier/default if omitted)" }
    },
    required: ["task"]
  },
  async execute(context: ToolContext, args: { task: string, model?: string }): Promise<ToolResult> {
    if (!context.runLoop || !context.toolRegistry || !context.callLlm) {
      return { ok: false, error: "Subagent execution not available: missing runLoop/toolRegistry/callLlm in context" }
    }

    // Build a sub-registry WITHOUT spawn tools (recursion guard)
    const subRegistry = context.toolRegistry.without(["spawn_subagent", "spawn_subagents"])
    const messages = [{ role: "user", content: args.task }]
    const tools = subRegistry.getDefinitions()

    // Run the nested loop (each tool call inside gets its own fresh sandbox
    // because sandboxExecutor.execute() is stateless)
    const result = await context.runLoop(messages, tools, {
      callLlm: context.callLlm,
      sandboxExecutor: context.sandboxExecutor,
      toolRegistry: subRegistry,
      statsRecorder: context.statsRecorder,  // records sub-agent calls with role="subagent"
      maxIterations: context.maxSubIterations ?? 3,  // lower than parent's max
      model: args.model  // optional override
    })

    return result.ok
      ? { ok: true, output: result.text }
      : { ok: false, error: result.reason }
  }
}
```

Key points:
- `subRegistry.without(...)` returns a new registry excluding spawn tools (recursion guard).
- `context.runLoop` is the same `runLoop` from change 1 — no new loop function.
- `statsRecorder` is passed through so sub-agent LLM calls are recorded. The `runLoop` implementation (from change 1) calls `statsRecorder?.recordLlmCall()` with a `role` parameter — this change passes `role="subagent"` in the deps.
- `maxSubIterations` defaults to 3 (lower than the parent's 5) to bound sub-agent runtime.

### 3. `spawn_subagents` implementation (parallel)

```typescript
// src/tools/spawn-subagents.ts
export const spawnSubagentsTool: Tool = {
  name: "spawn_subagents",
  description: "Spawn multiple sub-agents in parallel for independent sub-tasks. Each runs its own loop with a fresh sandbox.",
  parameters: {
    type: "object",
    properties: {
      tasks: { type: "array", items: { type: "string" }, description: "Array of task descriptions" },
      model: { type: "string", description: "Model to use for all sub-agents (optional)" }
    },
    required: ["tasks"]
  },
  async execute(context: ToolContext, args: { tasks: string[], model?: string }): Promise<ToolResult> {
    const maxConcurrent = context.maxSubagents ?? 3

    // Process in batches of maxConcurrent
    const results: string[] = []
    for (let i = 0; i < args.tasks.length; i += maxConcurrent) {
      const batch = args.tasks.slice(i, i + maxConcurrent)
      const batchResults = await Promise.all(
        batch.map(task => spawnSubagentTool.execute(context, { task, model: args.model }))
      )
      results.push(...batchResults.map(r => r.ok ? r.output : `[failed: ${r.error}]`))
    }

    return { ok: true, output: JSON.stringify(results) }
  }
}
```

Batching with `Promise.all` over slices ensures no more than `MAX_SUBAGENTS` sandboxes exist at once. Each `spawnSubagentTool.execute` call invokes `context.runLoop`, which invokes `sandboxExecutor.execute` — and since the executor is stateless, concurrent calls each create their own containers.

- Alternative considered: use a semaphore or worker pool — rejected; batching is simpler and sufficient for the expected scale (a handful of sub-agents, not hundreds).

### 4. Recursion guard: `ToolRegistry.without()`

Add a `without(names: string[]): ToolRegistry` method to `ToolRegistry` that returns a new registry excluding the named tools. This is a shallow copy (tools themselves are not deep-cloned, only the registry's internal map is copied). The `spawn_subagent` and `spawn_subagents` tools are excluded from the sub-registry, so the LLM in the sub-agent's loop never sees them as available tools.

### 5. Stats: `role="subagent"`

`runLoop` (from change 1) calls `statsRecorder?.recordLlmCall()` at each LLM call. Change 1's `LlmCallStats` includes a `role` field (change 2's SQLite recorder writes it). This change passes `role: "subagent"` in the `runLoop` deps when called from `spawn_subagent`. The parent's `runLoop` passes `role: "main"` (from change 2). The classifier passes `role: "classifier"` (from change 3).

No schema change needed — change 2's `llm_calls` table has a `role TEXT NOT NULL` column that already accepts any string.

### 6. Config: `MAX_SUBAGENTS`

```
MAX_SUBAGENTS=3   # max concurrent subagents in spawn_subagents
```

Read in `config.ts` (pure resolver `resolveMaxSubagents`, same pattern as change 1's other resolvers). Passed into the `ToolContext` at wiring time.

## Risks / Trade-offs

- [Sub-agent recursion via other tools] → Mitigated by excluding `spawn_subagent`/`spawn_subagents` from the sub-registry. A sub-agent cannot request a tool it doesn't know about.
- [Resource exhaustion from many parallel sandboxes] → Mitigated by `MAX_SUBAGENTS` batching (default 3). Each sandbox also has its own CPU/memory limits from change 1.
- [Sub-agent latency adds to parent message latency] → Accepted; parallel execution mitigates this, and the parent LLM decides when to use subagents. Stats (role="subagent") let the user observe the overhead.
- [Nested stats recording may confuse the `message_id` linkage] → Accepted; all sub-agent LLM calls are recorded under the parent message's `message_id` (the `runLoop` call receives the parent's `message_id` in its deps). This is correct — the user wants to see total tokens per message including sub-agents.

## Open Questions

(none)
