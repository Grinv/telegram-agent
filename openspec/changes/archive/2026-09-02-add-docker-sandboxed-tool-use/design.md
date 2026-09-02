## Context

See proposal.md — Why. The bot is currently a one-shot text relay with no tool-use. The existing architecture (see openspec/specs/) has:

- `src/orchestrator.ts`: one-shot handler — `callLlm(prompt)` → reply. Injects `callLlm` for testability.
- `src/llm/inference-caller.ts`: forks a child process per LLM call, sends `{ prompt, provider }` over IPC, enforces a timeout.
- `src/llms/ollama/index.ts`: calls `/api/generate` with `{ model, prompt, stream: false }`, injectable `fetchImpl`.
- `src/llms/stub/index.ts`: returns a placeholder string.
- `BaseConnector.callLlm(prompt: string): Promise<LlmResult>` — the contract every provider implements.

No Docker files exist. Docker 29.7.2 + Compose v5.4.0 are available on the host.

## Goals / Non-Goals

**Goals:**
- Let the LLM request tool calls (command execution, file operations) and feed results back, in a think → act → observe loop.
- Execute every tool call inside an ephemeral Docker sandbox with strict isolation.
- Containerize the bot + Ollama for reproducible deployment with simple start/stop.
- Preserve the pluggable-provider pattern (`LLM_PROVIDER`, `connector-registry`, forked child-process isolation).

**Non-Goals:**
- Persistent conversation history across messages — the bot stays memoryless between messages; the loop only exists within a single message's handling.
- Sandboxing the bot itself — it needs Docker socket + Telegram API + Ollama network access.
- A general-purpose plugin system for sandbox images — one pre-built Alpine image, one set of tools.
- Network access from inside the sandbox — explicitly disabled.
- Supporting non-Ollama tool-calling providers in this change — the stub connector returns text-only (contract-compliant); other providers can be added later by implementing the extended contract.

## Decisions

### 1. BaseConnector contract: extend, don't fork

Evolve `callLlm(prompt: string)` to `callLlm(request: LlmRequest)` where:

```
LlmRequest  = { prompt: string, messages?: ChatMessage[], tools?: ToolDefinition[], model?: string }
LlmSuccess  = { ok: true, text: string, toolCalls?: ToolCall[], usage?: TokenUsage }
TokenUsage  = { promptTokens: number, completionTokens: number, totalDurationMs?: number }
```

The old single-prompt path becomes `callLlm({ prompt })` — a one-liner call site change. The stub connector ignores `tools`, `model`, and returns text (no `toolCalls`, no `usage`), so it stays contract-compliant without knowing about tools or tokens. The `LLM_PROVIDER` + `connector-registry` + forked-child-process pattern is unchanged.

The `model?` and `usage?` fields are **forward-compatibility hooks** for later changes: `model?` lets a classifier-routing change select a model per call without touching the connector contract again; `usage?` lets a stats change read real token counts (Ollama's `prompt_eval_count`/`eval_count`) without re-modifying `LlmResult`. Both are optional — existing callers and the stub are unaffected.

- Alternative considered: add a separate `callLlmWithTools()` method alongside `callLlm(prompt)` — rejected; it duplicates the isolation/timeout/IPC machinery and forces every future connector to implement two methods.
- Alternative considered: keep `callLlm(prompt: string)` and parse tool calls from the LLM's text output (JSON-in-prose) — rejected; Ollama supports native tool calling via `/api/chat`, and text parsing is fragile and model-specific.
- Alternative considered: defer `model?` and `usage?` to later changes — rejected; adding them now is zero-cost (optional fields, stub ignores them) and avoids re-modifying the same types in 3 separate changes.

### 2. Ollama connector: switch to /api/chat

`/api/generate` (current) doesn't support tools. `/api/chat` accepts `messages` + `tools` and returns `message.tool_calls`. Switch to `/api/chat` for all calls — even without tools, `/api/chat` with a single user message works and simplifies the connector to one code path.

The `/api/chat` response shape differs from `/api/generate`:
- Generate: `{ response: "text" }`
- Chat: `{ message: { role: "assistant", content: "text", tool_calls: [...] } }`

The connector maps this to the extended `LlmResult` type:
- `message.content` → `result.text`
- `message.tool_calls` → `result.toolCalls`
- `prompt_eval_count` → `result.usage.promptTokens`
- `eval_count` → `result.usage.completionTokens`
- `total_duration` (nanoseconds) → `result.usage.totalDurationMs` (divided by 1e6)
- `request.model` (if set) overrides the connector's default `this.model` in the request body

### 3. Docker interaction: Docker CLI via child_process, not Engine API over Unix socket

The sandbox executor calls `docker` via `child_process.execFile` (spawn the CLI, not a shell). Reasons:
- `child_process` is already used in this codebase (inference-caller forks the runner).
- The Docker Engine REST API over Unix socket requires a custom HTTP client (Node's `fetch` can't target Unix sockets without `undici.Agent`, which isn't in the project's convention); the CLI is simpler.
- The bot container installs `docker-cli` via `apk add docker-cli` (small, no Docker daemon needed — the daemon runs on the host, socket-mounted).

CLI commands used:
- Create sandbox: `docker run -d --rm --read-only --network none --memory <mem> --cpus <cpu> -v <workdir>:/work -w /work --entrypoint sleep <image> infinity`
- Exec tool: `docker exec <id> sh -c "<command>"` (or `cat`, `ls`, etc.)
- Tear down: `docker stop -t 0 <id>` (--rm auto-removes)
- Per-tool timeout: `docker exec <id> timeout <seconds> sh -c "<command>"` (busybox `timeout` is in Alpine)

- Alternative considered: Docker Engine API over Unix socket via `http.request({ socketPath })` — rejected; more code, harder to test, no benefit over CLI for this use case.
- Alternative considered: `dockerode` npm package — rejected; violates the no-third-party-SDK convention.

### 4. Sandbox lifecycle: one sandbox per act step, sequential tool execution

When the LLM returns N tool calls in one iteration, one sandbox container is created, all N tools execute sequentially inside it (so a later tool can read a file an earlier one wrote), then the container is torn down. A new iteration → a new sandbox.

- Alternative considered: one sandbox per individual tool call (maximum isolation) — rejected; too expensive (container start latency × N), and tools within one LLM turn are often dependent (write then read).
- Alternative considered: one sandbox per message (reuse across iterations) — rejected; the user explicitly wants a fresh sandbox per tool-use request, and cross-iteration isolation prevents state accumulation bugs.

### 5. Sandbox executor is injectable for testing

`DockerSandboxExecutor` accepts an injectable `execFile` function (same pattern as `OllamaConnector`'s `fetchImpl`). Tests pass a fake that returns canned stdout/stderr/exit-code without touching Docker. The orchestrator accepts the executor as a dependency (like `callLlm`), so the loop can be tested end-to-end with fakes.

### 6. Tool registry: declarative, no orchestrator coupling

Tools are registered in a `ToolRegistry` with their name, description, JSON-Schema parameters, and a handler function `(context: ToolContext, args) => Promise<ToolResult>`. The orchestrator fetches tool definitions from the registry to pass to the LLM, and dispatches tool calls back to the registry by name. Adding a tool = register it; no orchestrator change.

`ToolContext` is the execution environment passed to every tool handler:

```
ToolContext = {
  execInContainer: (command: string) => Promise<{ stdout: string, stderr: string, exitCode: number }>
}
```

Tools use `context.execInContainer` and ignore any other fields. This is a forward-compatibility hook: a later change (subagents) will extend `ToolContext` with `callLlm`, `sandboxExecutor`, `toolRegistry`, and `runLoop` — existing tools continue to work unchanged because they only read `execInContainer`.

- Alternative considered: pass `execInContainer` directly as the first argument to tool handlers — rejected; a later change would need to change the handler signature and rewrite every tool. `ToolContext` is extensible without signature changes.

Initial tools (all implemented via `docker exec` inside the sandbox):
- `execute_command(command: string)` — runs a shell command, returns stdout/stderr/exit code
- `read_file(path: string)` — `cat <path>`
- `write_file(path: string, content: string)` — writes content via stdin to `cat > <path>`
- `list_files(path: string)` — `ls -la <path>`

### 7. Orchestrator loop structure

The loop is extracted as a standalone `runLoop()` function, callable independently of `createMessageHandler`. This is a forward-compatibility hook: a later change (subagents) will call `runLoop()` recursively to spawn nested agents without duplicating orchestrator logic.

```
runLoop(messages, tools, deps):
  for (i in 0..maxIterations):
      result = callLlm({ prompt: messages[0].content, messages, tools, model: deps.model? }, deps)
      deps.statsRecorder?.recordLlmCall({ iteration: i, model, usage: result.usage, ... })
      if !result.ok → return { ok: false, reason: result.reason }
      if result.toolCalls is empty → return { ok: true, text: result.text }
      observations = sandboxExecutor.execute(result.toolCalls, toolRegistry)
      deps.statsRecorder?.recordToolCalls({ iteration: i, toolCalls: observations, ... })
      messages.push({ role: 'assistant', content: result.text, tool_calls: result.toolCalls })
      observations.forEach(o => messages.push({ role: 'tool', content: o.output, name: o.name }))
  return { ok: false, reason: 'MAX_ITERATIONS' }

createMessageHandler(deps):
  return async (message):
    statsRecorder?.recordMessage({ received: Date.now(), chatId, prompt })
    messages = [{ role: 'user', content: message.text }]
    tools = registry.definitions()   // empty → one-shot, no sandbox
    result = runLoop(messages, tools, deps)
    reply = result.ok ? result.text : FAILURE_REPLY_TEXT
    statsRecorder?.recordMessage({ ...replySent: Date.now(), reply, iterations, ok })
    client.sendMessage(chatId, reply)
```

When `tools` is empty (no tools registered), the first LLM call returns text-only (stub) or text without tool_calls (Ollama with no `tools` param), and the loop exits on iteration 0 — identical to the current one-shot behavior. This is the backward-compatible fallback.

`statsRecorder` is an optional dependency (`undefined` by default). When undefined, `statsRecorder?.recordLlmCall()` is a no-op (optional chaining). A later change (`add-sqlite-stats`) will inject a real `SqliteStatsRecorder` without modifying the orchestrator — it only depends on the `StatsRecorder` interface, defined in this change as:

```
StatsRecorder = {
  recordMessage(stats: MessageStats): void
  recordLlmCall(stats: LlmCallStats): void
  recordToolCall(stats: ToolCallStats): void
}
```

The interface is defined here (in `src/llm/types.ts` or a new `src/stats/types.ts`), but the SQLite implementation is deferred to `add-sqlite-stats`. This change only adds the interface and the hook points.

### 8. Docker deployment: docker-compose + npm scripts

`docker-compose.yml` defines two services (`bot`, `ollama`) on a shared network. The bot container is built from a `Dockerfile` (Node 24 Alpine + `docker-cli`), mounts the Docker socket, and reads `.env`. The sandbox image is built from `sandbox/Dockerfile` (Alpine + coreutils).

npm scripts provide the simple start/stop the user asked for:
- `npm run sandbox:build` — builds the sandbox image
- `npm run docker:up` — `docker compose up -d --build` (builds + starts bot + Ollama)
- `npm run docker:down` — `docker compose down`
- `npm run docker:logs` — `docker compose logs -f`

### 9. Configuration: new env vars

| Variable | Default | Description |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://ollama:11434` | **changed** from `http://127.0.0.1:11434` |
| `SANDBOX_IMAGE` | `telegram-agent-sandbox` | Pre-built sandbox image name |
| `SANDBOX_TIMEOUT_MS` | `30000` | Sandbox container max lifetime |
| `SANDBOX_MEMORY_LIMIT` | `256m` | Docker `--memory` |
| `SANDBOX_CPU_LIMIT` | `0.5` | Docker `--cpus` |
| `TOOL_USE_MAX_ITERATIONS` | `5` | Max think→act→observe iterations per message |

### 10. Statistics deferred to a separate change

Statistics measurement (timing, token counts, before/after comparison) is **not** implemented in this change. This change only adds the forward-compatibility hooks:
- `usage?` field on `LlmResult` (Ollama fills it from `prompt_eval_count`/`eval_count`)
- `statsRecorder?` dependency on the orchestrator (optional, `undefined` = no-op)
- `StatsRecorder` interface (defined but not implemented)

The actual SQLite implementation, `.md` report generation, and before/after measurement are deferred to the `add-sqlite-stats` change, which will inject a `SqliteStatsRecorder` into the orchestrator without modifying types or the orchestrator. This keeps this change focused on tool-use + sandbox isolation, and lets stats be developed and tested independently.

## Risks / Trade-offs

- [Docker socket mounted into bot container = root-equivalent access if compromised] → Accepted; the bot needs it to spawn sandboxes. Mitigation: the bot runs as non-root inside its container, and the sandbox itself has no Docker socket access.
- [Ollama model must support tool calling] → `llama3` (current default) does not support tools. `OLLAMA_MODEL` must be set to a tool-capable model (e.g. `qwen2.5`, `llama3.1`, `mistral-nemo`). Documented in `.env.example` and README.
- [Sandbox container start latency (~0.5–1s per act step)] → Accepted; this is inherent to container-based isolation. Mitigation: Alpine image is small and fast to start; sequential tools in one sandbox amortize the cost.
- [CLI-based Docker interaction is less type-safe than a typed API client] → Accepted; the CLI is simpler and the command surface is small (run, exec, stop). Mitigation: the `DockerSandboxExecutor` encapsulates all CLI calls behind a typed interface, so the rest of the codebase never sees raw CLI.
- [`write_file` via `docker exec` stdin is fragile with binary content] → Accepted for now; initial tools handle text only. Binary file support can be added later if needed.

## Migration Plan

1. Build the sandbox image: `npm run sandbox:build`
2. Set `OLLAMA_MODEL` to a tool-capable model in `.env` (e.g. `qwen2.5`), `ollama pull` it
3. Set `OLLAMA_BASE_URL=http://ollama:11434` in `.env` (or keep `127.0.0.1` for local non-Docker dev)
4. `npm run docker:up` to start the stack
5. Rollback: `npm run docker:down`, revert to previous `OLLAMA_BASE_URL`/`OLLAMA_MODEL`, run `npm run dev` as before

## Open Questions

(none — all resolved during exploration: `ToolContext` is forward-compatible, `runLoop` is extracted, `model?`/`usage?`/`statsRecorder?` are optional hooks for later changes, stats implementation is deferred to `add-sqlite-stats`, model routing is deferred to `add-classifier-routing`, subagents are deferred to `add-parallel-subagents`.)
