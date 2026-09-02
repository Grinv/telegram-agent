## Context

See proposal.md — Why. After changes 1–3:
- `runLoop` is a standalone function extracted from `createMessageHandler` (change 1).
- `ToolContext = { execInContainer }` — extensible by design (change 1).
- `DockerSandboxExecutor.execute()` is stateless — it creates a sandbox, runs tools, tears down, returns. Multiple concurrent calls each get their own container (change 1).
- Stats records `role` per LLM call; `role="subagent"` is a new value for this change (change 2 schema already supports it).
- `LlmRequest.model?` lets a sub-agent use a specific model (change 1 + change 3's routing).

This change adds two tools (`spawn_subagent`, `spawn_subagents`) that call `runLoop` recursively. These are just tools in the registry — `createMessageHandler` (the orchestrator's message-handling logic) is not modified. `runLoop` itself does gain one new optional dep (`role`, see Decision 5) and `DockerSandboxExecutor` gains a constructor-time context-injection mechanism (see Decision 7) — both are small, additive, and necessary for the tools to actually work end-to-end at runtime, not just be registered.

## Goals / Non-Goals

**Goals:**
- Let the LLM decompose a task and process independent parts in parallel.
- Each sub-agent gets its own sandbox (isolation) and its own loop (independent LLM context).
- Recursion guard: sub-agents cannot spawn sub-agents.
- Concurrency limit: `MAX_SUBAGENTS` caps parallel sandboxes.
- Stats: sub-agent calls recorded with `role="subagent"`.

**Non-Goals:**
- Rewriting orchestrator message-handling logic — subagents are tools, not an orchestrator feature; `createMessageHandler` is unchanged. (`runLoop` does gain one new optional `role` dep, needed purely so stats can attribute sub-agent calls — see Decision 5.)
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
  provider?: string       // required alongside callLlm — runLoop's deps need it
  timeoutMs?: number      // required alongside callLlm — runLoop's deps need it
  sandboxExecutor?: SandboxExecutor
  toolRegistry?: ToolRegistry
  runLoop?: typeof runLoop
  router?: Router
  statsRecorder?: StatsRecorder
  maxSubIterations?: number
  maxSubagents?: number
}
```

`provider`/`timeoutMs` are listed as their own fields (not folded into `callLlm`'s closure) because `runLoop`'s `LoopDeps` requires them as plain values to build each inference call's `options` — see `src/orchestrator.ts`'s existing `LoopDeps`. This was missing from the field list originally drafted for this change and had to be added during implementation once `spawn_subagent` needed to actually construct a `LoopDeps` object.

The `spawn_subagent` tool checks that `runLoop`, `sandboxExecutor`, `toolRegistry`, `callLlm`, `provider`, and `timeoutMs` are present in the context. If any is missing, it returns an error (the tool should not have been registered without them). `router` and `statsRecorder` are optional — a sub-agent can run without routing or stats.

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
    if (!context.runLoop || !context.toolRegistry || !context.callLlm ||
        !context.sandboxExecutor || context.provider === undefined || context.timeoutMs === undefined) {
      return { ok: false, error: "Subagent execution not available: missing runLoop/toolRegistry/callLlm/sandboxExecutor/provider/timeoutMs in context" }
    }

    // Build a sub-registry WITHOUT spawn tools (recursion guard)
    const subRegistry = context.toolRegistry.without(["spawn_subagent", "spawn_subagents"])
    const messages = [{ role: "user", content: args.task }]
    const tools = subRegistry.getDefinitions()

    // Run the nested loop (each tool call inside gets its own fresh sandbox
    // because sandboxExecutor.execute() is stateless)
    const result = await context.runLoop(messages, tools, {
      callLlm: context.callLlm,
      provider: context.provider,
      timeoutMs: context.timeoutMs,
      sandboxExecutor: context.sandboxExecutor,
      toolRegistry: subRegistry,
      statsRecorder: context.statsRecorder,  // records sub-agent calls with role="subagent"
      maxIterations: context.maxSubIterations ?? 3,  // lower than parent's max
      model: args.model,  // optional override
      role: "subagent"    // new optional LoopDeps field (Decision 5) — attributes every
                           // LLM call this nested loop makes to role="subagent" in stats
    })

    return result.ok
      ? { ok: true, output: result.text }
      : { ok: false, error: result.reason }
  }
}
```

Key points:
- `subRegistry.without(...)` returns a new registry excluding spawn tools (recursion guard).
- `context.runLoop` is the same `runLoop` from change 1 — no new loop function, only a new optional `role` field on its deps (Decision 5).
- `provider`/`timeoutMs` are passed through from context because `LoopDeps` requires them as plain values, not just embedded in `callLlm`'s closure.
- `statsRecorder` is passed through so sub-agent LLM calls are recorded — every iteration of the sub-agent's loop, not only its final answer, since each is a real LLM call with real token cost (same as the parent's `role="main"` calls already are).
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

`runLoop` (from change 1) calls `statsRecorder?.recordLlmCall()` at each LLM call — once per loop iteration, not only for the final answer, since every iteration is a real LLM call with real token/latency cost that the stats report needs to account for. `LlmCallStats.role` (change 2) already existed as a field, and change 2's SQLite recorder already writes whatever string it's given, but `LoopDeps` itself (the parameters `runLoop` takes) had no `role` field before this change — `createMessageHandler` never needed to pass one, since it always meant `"main"`. This change adds an optional `role?: 'main' | 'classifier' | 'subagent'` to `LoopDeps`, defaulting through unset (the recorder's existing `stats.role ?? 'main'` fallback still applies), and `spawn_subagent` passes `role: "subagent"` when it calls `runLoop`. The classifier passes `role: "classifier"` (from change 3) via a separate, direct `recordLlmCall` — it doesn't go through `runLoop`/`LoopDeps` at all.

Note the DB only stores `role`/`model`/token counts/latency/`ok` per call, not the call's text or tool-call content — `LlmCallStats.text`/`toolCalls` exist on the type but `SqliteStatsRecorder` doesn't persist them. So this does not mean a sub-agent's intermediate reasoning text is being logged anywhere; only its token/latency footprint is, exactly as already happens for the parent's `role="main"` calls.

No schema change needed — change 2's `llm_calls` table has a `role TEXT NOT NULL` column that already accepts any string.

### 6. Config: `MAX_SUBAGENTS`

```
MAX_SUBAGENTS=3   # max concurrent subagents in spawn_subagents
```

Read in `config.ts` (pure resolver `resolveMaxSubagents`, same pattern as change 1's other resolvers). Passed into the `ToolContext` at wiring time.

### 7. How the extended `ToolContext` fields actually reach a tool at runtime

Decision 1 adds fields to the `ToolContext` *type*, but a tool only ever receives the `ToolContext` *value* that `DockerSandboxExecutor.execute()` constructs per call — and before this change, that was unconditionally just `{ execInContainer }`:

```typescript
// src/sandbox/sandbox-executor.ts, execute(), before this change:
const context: ToolContext = {
  execInContainer: (command, stdin) => this.execInContainer(containerId, command, stdin),
};
```

This is a gap the original design missed: adding fields to the `ToolContext` interface does nothing by itself — without also changing how `DockerSandboxExecutor` builds the per-call context, `spawn_subagent` would always see `context.runLoop === undefined` and hit its "not available" guard, even though the tool is correctly registered and advertised to the LLM.

Fix: `DockerSandboxExecutor`'s constructor takes an optional third parameter, `extraContext: Partial<ToolContext> = {}`, stored as-is (by reference, not cloned). `execute()` now spreads it into the per-call context:

```typescript
const context: ToolContext = {
  ...this.extraContext,
  execInContainer: (command, stdin) => this.execInContainer(containerId, command, stdin),
};
```

`src/index.ts` builds one `extraContext` object up front with `callLlm`/`provider`/`timeoutMs`/`runLoop`/`statsRecorder?`/`router?`/`maxSubagents`/`maxSubIterations`, passes it to `createSubagentToolRegistry` (to decide whether to register the spawn tools) — then mutates the *same* object in place to add `toolRegistry` (once built) and `sandboxExecutor` (once constructed) before passing it into `new DockerSandboxExecutor(config, undefined, extraContext)`. This resolves `sandboxExecutor`'s self-reference (`extraContext.sandboxExecutor` must equal the very `DockerSandboxExecutor` instance being constructed) without a two-phase construction API: because `execute()` reads `this.extraContext` fresh on every call rather than snapshotting it at construction time, the late mutation is picked up correctly once the bot starts handling messages.

- Alternative considered: pass extra context as a parameter to `SandboxExecutor.execute(toolCalls, registry, extraContext?)` on every call — rejected; it would require changing `orchestrator.ts`'s call site (`sandboxExecutor.execute(result.toolCalls, toolRegistry)`) on every iteration, touching the orchestrator more than the constructor-injection approach does, and the extra context doesn't change per call within one bot process anyway.
- Alternative considered: construct `DockerSandboxExecutor` twice (once to get a reference, once "for real") — rejected as needlessly complex next to a plain mutate-after-construct on a reference-held object.

## Risks / Trade-offs

- [Sub-agent recursion via other tools] → Mitigated by excluding `spawn_subagent`/`spawn_subagents` from the sub-registry. A sub-agent cannot request a tool it doesn't know about.
- [Resource exhaustion from many parallel sandboxes] → Mitigated by `MAX_SUBAGENTS` batching (default 3). Each sandbox also has its own CPU/memory limits from change 1.
- [Sub-agent latency adds to parent message latency] → Accepted; parallel execution mitigates this, and the parent LLM decides when to use subagents. Stats (role="subagent") let the user observe the overhead.
- [Nested stats recording may confuse the `message_id` linkage] → Accepted; `LoopDeps`/`runLoop` never carry a `message_id` at all — `SqliteStatsRecorder` attributes every `recordLlmCall`/`recordToolCall` to whichever message is `currentPending` (the most recently started message, per its own existing doc comment), and since sub-agents only ever run synchronously nested inside the single message currently being handled (the bot processes one message at a time), sub-agent calls land under the correct parent `message_id` without any new plumbing. This is correct — the user wants to see total tokens per message including sub-agents — but it's an existing, pre-change limitation, not something this change adds: truly concurrent messages (if the bot ever handled more than one at once) would already misattribute stats to each other, subagents or not.
- [`DockerSandboxExecutor.extraContext` is mutated after construction] → `src/index.ts` builds `extraContext` before `toolRegistry`/`sandboxExecutor` exist, then mutates the same object in place once each is built (see Decision 7), rather than passing a fully-formed object to the constructor. This only works because `extraContext` is held by reference and re-spread on every `execute()` call, not copied at construction time — a future refactor that changes `DockerSandboxExecutor` to snapshot `extraContext` in its constructor would silently break `spawn_subagent` (it would never see `toolRegistry`/`sandboxExecutor`). Mitigation: none implemented yet beyond this note — a follow-up could tighten the constructor's doc comment to call out the by-reference requirement explicitly, or have `index.ts` construct `sandboxExecutor` differently to avoid the self-reference mutation entirely.

## Open Questions

(none)
