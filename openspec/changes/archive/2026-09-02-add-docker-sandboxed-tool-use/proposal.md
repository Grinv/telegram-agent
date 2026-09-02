## Why

The bot is currently a one-shot text relay (message → LLM → reply) with no ability to take action. To be useful as an agent, it needs tool-use: the LLM should be able to execute commands and manipulate files to answer questions that require computation or filesystem access. Tool execution must be strictly isolated (an LLM-run command must never touch the host), so each tool call runs inside an ephemeral Docker sandbox with a read-only filesystem, no host network, and resource/time limits. Containerizing the bot and Ollama as separate Docker containers also gives reproducible deployment and simple start/stop commands.

## What Changes

- Add a **tool interface** (`{ name, args, result }`) and an initial set of tools (`execute_command`, `read_file`, `write_file`, `list_files`) so new tools can be added without touching the orchestrator. Tools receive a `ToolContext` (not a raw `execInContainer` function) so the context can be extended in later changes without rewriting existing tools.
- Add a **Docker sandbox executor** that spawns an ephemeral Alpine container per tool-use request: read-only rootfs, a writable workdir mount, no host network, CPU/memory caps, and an auto-kill timeout. The sandbox is torn down after each act step.
- Evolve the **orchestrator** from one-shot (`message → LLM → reply`) to a **think → act → observe loop**: send the user message + available tools to the LLM; if the LLM requests tool calls, spawn a fresh sandbox, execute the tools, feed results back to the LLM; repeat until the LLM produces a final text answer or a max-iteration cap is reached. The loop is extracted as a standalone `runLoop()` function so it can be invoked recursively by a later change (subagents) without duplicating orchestrator logic.
- Extend the **BaseConnector contract** to accept tool definitions and conversation history, and to return either text or tool-call requests. The stub connector returns text-only (no tool calls); the Ollama connector switches from `/api/generate` to `/api/chat` with the `tools` parameter when tools are provided.
- Add an optional `model` field to `LlmRequest` and an optional `usage` field (token counts) to `LlmResult`, so a later change (classifier routing) can select models per-call and a later change (stats) can record real token usage. Both fields are optional — existing callers and the stub connector are unaffected.
- Add an optional `statsRecorder` dependency to the orchestrator, defaulted to `undefined` (no-op). A later change (SQLite stats) will inject a real recorder; the orchestrator only depends on the interface, not on SQLite.
- **Containerize** the bot and Ollama as separate Docker containers on a shared Docker network (`ollama` reachable at `http://ollama:11434`). The bot container mounts the Docker socket so it can spawn sandbox containers; it is not itself sandboxed.
- Add a pre-built **sandbox image** (minimal Alpine with a shell and core utils) defined by its own Dockerfile.
- Add **`docker compose up`/`down`** lifecycle (via a `docker-compose.yml`) and **npm scripts** (`docker:up`, `docker:down`, `docker:logs`, `sandbox:build`) for simple start/stop.
- **BREAKING**: The `BaseConnector.callLlm` signature changes from `(prompt: string)` to `(request: LlmRequest)`, where `LlmRequest` carries the prompt, optional conversation messages, optional tool definitions, and an optional model override. Any out-of-tree connector would need updating. The `LlmResult` type is extended with optional `toolCalls` and `usage` fields.
- **BREAKING**: `OLLAMA_BASE_URL` default changes from `http://127.0.0.1:11434` to `http://ollama:11434` (the Docker network hostname), reflecting the containerized deployment. Local non-Docker users must set `OLLAMA_BASE_URL=http://127.0.0.1:11434` explicitly.

## Capabilities

### New Capabilities
- `sandbox-execution`: Docker-sandboxed tool execution — ephemeral container lifecycle, isolation guarantees (read-only rootfs, no host network, resource limits, timeout kill), and the tool interface (`{ name, args, result }`) that lets new tools be added without changing the orchestrator.
- `docker-deployment`: Containerization of the bot and Ollama as separate Docker containers on a shared network, the pre-built sandbox image, and simple start/stop lifecycle commands.

### Modified Capabilities
- `bot-orchestrator`: Evolves from one-shot message handling to a think → act → observe tool-use loop with a max-iteration cap; the one-shot path remains as a fallback when no tools are available.
- `llm-inference`: The connector contract extends to accept tool definitions and conversation history, and to return tool-call requests in addition to text; the stub connector remains text-only.

## Impact

- `src/llm/base-connector.ts` / `src/llm/types.ts`: `callLlm` signature and `LlmResult` extended (breaking for out-of-tree connectors); `LlmRequest` gains optional `model`; `LlmResult` gains optional `toolCalls` and `usage`.
- `src/llms/ollama/index.ts`: switches to `/api/chat` with `tools` when provided; default `OLLAMA_BASE_URL` → `http://ollama:11434`; passes `request.model` through to the `/api/chat` body when set; reads token counts (`prompt_eval_count`, `eval_count`) from the response into `LlmResult.usage`.
- `src/llms/stub/index.ts`: returns text-only (no tool calls, no `usage`) — contract-compliant default.
- `src/llm/inference-caller.ts` / `inference-runner.ts`: IPC payload extended to carry `LlmRequest` (messages, tools, model) across the fork boundary.
- `src/orchestrator.ts`: rewritten from one-shot to think → act → observe loop; loop extracted as `runLoop()` for future reuse; injectable `sandboxExecutor`, `toolRegistry`, and `statsRecorder?` (optional, no-op when undefined) for testability and forward compatibility.
- New: `src/sandbox/` — Docker CLI wrapper (`docker-cli.ts`) and `DockerSandboxExecutor` (`sandbox-executor.ts`), both accepting injectable `execFile`/`dockerExec` for testing.
- New: `src/tools/` — `ToolContext` interface, `ToolRegistry`, and initial tool implementations (`execute_command`, `read_file`, `write_file`, `list_files`), all using `ToolContext.execInContainer`.
- New: `Dockerfile` (bot), `sandbox/Dockerfile` (minimal Alpine sandbox image), `docker-compose.yml`, `.dockerignore`.
- `package.json`: new scripts (`docker:up`, `docker:down`, `docker:logs`, `sandbox:build`).
- `.env.example` / `README.md`: updated for Docker deployment, new env vars (`SANDBOX_IMAGE`, `SANDBOX_TIMEOUT_MS`, `SANDBOX_CPU_LIMIT`, `SANDBOX_MEMORY_LIMIT`, `TOOL_USE_MAX_ITERATIONS`).
- Tests: new test directories `test/sandbox/` and `test/tools/`; existing orchestrator tests updated for the loop.
- No external npm dependencies added — Docker is driven via `child_process.execFile('docker', ...)` (the CLI), consistent with the project's no-SDK convention.
- Statistics measurement is deferred to a separate change (`add-sqlite-stats`); this change only adds the `statsRecorder?` hook point and `usage?` field so the later change can plug in without modifying the orchestrator or types again.
