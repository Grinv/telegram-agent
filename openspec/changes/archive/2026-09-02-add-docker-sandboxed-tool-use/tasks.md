## 1. Types & Connector Contract

- [x] 1.1 Define `LlmRequest` (`{ prompt: string, messages?: ChatMessage[], tools?: ToolDefinition[], model?: string }`), `ChatMessage` (user/assistant/tool union), `ToolDefinition` (`{ name, description, parameters }`), `ToolCall` (`{ name, arguments }`), `ToolResult` (`{ ok: boolean, output?: string, error?: string }`), and `TokenUsage` (`{ promptTokens: number, completionTokens: number, totalDurationMs?: number }`) in `src/llm/types.ts`. Extend `LlmSuccess` with optional `toolCalls?: ToolCall[]` and `usage?: TokenUsage`. Verify: `tsc --noEmit` passes.
- [x] 1.2 Update `BaseConnector.callLlm` signature from `(prompt: string)` to `(request: LlmRequest)` in `src/llm/base-connector.ts`. Verify: `tsc --noEmit` passes (will show errors in connectors/caller — expected, fixed in later tasks).
- [x] 1.3 Define the `StatsRecorder` interface (`{ recordMessage, recordLlmCall, recordToolCall }`) and associated stat types (`MessageStats`, `LlmCallStats`, `ToolCallStats`) in `src/stats/types.ts`. This is the interface only — no implementation. Verify: `tsc --noEmit` passes.

## 2. Tool Interface & Registry

- [x] 2.1 Create `src/tools/types.ts` defining the `Tool` interface: `{ name, description, parameters (JSON Schema), execute(context: ToolContext, args) => Promise<ToolResult> }` where `ToolContext` is `{ execInContainer: (command: string) => Promise<{ stdout: string, stderr: string, exitCode: number }> }`. The `ToolContext` interface is intentionally extensible so later changes can add fields without rewriting tools. Verify: file exists, `tsc --noEmit` passes.
- [x] 2.2 Create `src/tools/registry.ts` with a `ToolRegistry` class: `register(tool)`, `getDefinitions()` (returns `ToolDefinition[]` for the LLM), `getTool(name)` (returns a `Tool` or throws), `isEmpty()` (returns boolean). Verify: unit test registering and retrieving a tool passes.
- [x] 2.3 Implement `execute_command` tool in `src/tools/execute-command.ts` — calls `context.execInContainer(command)`, returns `{ ok: exitCode === 0, output: stdout, error: stderr }`. Verify: unit test with a fake `ToolContext.execInContainer` returning exit code 0 and 1 passes.
- [x] 2.4 Implement `read_file` tool in `src/tools/read-file.ts` — calls `context.execInContainer("cat <path>")`, returns file contents or error. Verify: unit test with fake context passes.
- [x] 2.5 Implement `write_file` tool in `src/tools/write-file.ts` — calls `context.execInContainer` with stdin piping (`cat > <path>`), returns success/failure. Verify: unit test with fake context passes.
- [x] 2.6 Implement `list_files` tool in `src/tools/list-files.ts` — calls `context.execInContainer("ls -la <path>")`, returns listing. Verify: unit test with fake context passes.
- [x] 2.7 Create `src/tools/index.ts` that exports all tools and a `createDefaultToolRegistry()` factory that registers all four tools. Verify: unit test confirming registry has 4 tools with correct names passes.

## 3. Docker Sandbox Executor

- [x] 3.1 Create `src/sandbox/docker-cli.ts` — a `dockerExec` helper wrapping `child_process.execFile('docker', ...)` with: `AbortSignal` support, timeout, and structured return `{ stdout, stderr, exitCode }`. Accept an injectable `execFile` function for testability (same pattern as `OllamaConnector.fetchImpl`). Verify: unit test with fake `execFile` returning canned output passes.
- [x] 3.2 Create `src/sandbox/sandbox-executor.ts` — `DockerSandboxExecutor` class with: `createSandbox()` (runs `docker run -d --rm --read-only --network none --memory <mem> --cpus <cpu> -v <workdir>:/work -w /work --entrypoint sleep <image> infinity`, returns container ID), `execInContainer(containerId, command)` (runs `docker exec <id> timeout <seconds> sh -c "<command>"`, returns `{ stdout, stderr, exitCode }`), `removeSandbox(containerId)` (runs `docker stop -t 0 <id>`), and `execute(toolCalls, registry)` (creates sandbox, executes each tool call sequentially via the registry, tears down sandbox in a `finally` block). Accept an injectable `dockerExec` function. Verify: unit test with fake `dockerExec` confirming create → exec → stop sequence passes.
- [x] 3.3 Add sandbox auto-kill timer: when `createSandbox()` is called, start a timer for `SANDBOX_TIMEOUT_MS`; if it fires before `removeSandbox()`, call `docker stop` on the container. Verify: unit test confirming the timer triggers `docker stop` when the sandbox outlives the timeout passes.

## 4. Ollama Connector Update

- [x] 4.1 Switch `OllamaConnector.callLlm` from `/api/generate` to `/api/chat`. Build the request body from `LlmRequest`: map `request.prompt` → `{ role: 'user', content: prompt }` (prepend to `request.messages` if provided), pass `request.tools` as the `tools` array, pass `request.model ?? this.model` as the `model` field. Parse the response `message.tool_calls` into `LlmResult.toolCalls`. Map `prompt_eval_count`/`eval_count`/`total_duration` from the response into `LlmResult.usage` (`TokenUsage`). Verify: unit test with fake `fetchImpl` returning a chat response with tool_calls and token counts passes.
- [x] 4.2 Unit test `OllamaConnector` chat response without tool_calls returns text-only `LlmResult` (with `usage` populated). Verify: test passes.
- [x] 4.3 Unit test `OllamaConnector` with conversation history (messages array) sends the full message list to `/api/chat`. Verify: test passes.
- [x] 4.4 Unit test `OllamaConnector` with `request.model` set overrides the connector's default model in the request body. Verify: test passes.
- [x] 4.5 Update `OllamaConnector` default `OLLAMA_BASE_URL` from `http://127.0.0.1:11434` to `http://ollama:11434`. Verify: read the constructor default and confirm it matches.

## 5. Stub Connector Update

- [x] 5.1 Update `StubConnector.callLlm` to accept `LlmRequest` (ignore `messages` and `tools`), return the existing placeholder text with no `toolCalls`. Verify: existing stub tests pass (updated for new signature).

## 6. Inference Caller & Runner Update

- [x] 6.1 Update `inference-runner.ts` `RunnerRequest` to carry `LlmRequest` instead of `prompt: string`. The runner calls `connector.callLlm(request)`. Verify: `tsc --noEmit` passes.
- [x] 6.2 Update `inference-caller.ts` `callLlmIsolated` to accept `LlmRequest` instead of `prompt: string`. IPC payload becomes `{ request, provider }`. Verify: `tsc --noEmit` passes.
- [x] 6.3 Update `inference-caller.test.ts` to pass `LlmRequest` objects instead of plain strings. Verify: `npm test` passes.

## 7. Orchestrator Rewrite

- [x] 7.1 Extract the think → act → observe loop as a standalone `runLoop(messages, tools, deps)` function in `src/orchestrator.ts` (or a new `src/orchestrator/loop.ts`), separate from `createMessageHandler`. `runLoop` accepts `callLlm`, `sandboxExecutor`, `toolRegistry`, `statsRecorder?` (optional), `maxIterations`, and `model?` as deps. It returns `{ ok: true, text }` or `{ ok: false, reason }`. Verify: `tsc --noEmit` passes.
- [x] 7.2 Rewrite `createMessageHandler` to call `runLoop`: accept `sandboxExecutor`, `toolRegistry`, and `statsRecorder?` as injected deps (alongside existing `callLlm`, `client`, `provider`, `timeoutMs`); build `messages` array, call `runLoop`, send reply or failure notice; fall back to one-shot when `toolRegistry.isEmpty()`. Call `statsRecorder?.recordMessage()` at message-received and reply-sent hook points (no-op when undefined). Verify: `tsc --noEmit` passes.
- [x] 7.3 Add `statsRecorder?.recordLlmCall()` and `statsRecorder?.recordToolCall()` hook points inside `runLoop` at each LLM call and each tool execution (no-op when undefined). Verify: unit test with a fake `statsRecorder` confirming all hook points are called passes.
- [x] 7.4 Update `src/index.ts` to wire the `ToolRegistry`, `DockerSandboxExecutor`, and new config into `createMessageHandler`. `statsRecorder` is left as `undefined` (deferred to `add-sqlite-stats`). Verify: `tsc --noEmit` passes.

## 8. Config

- [x] 8.1 Add new config fields to `AppConfig` and `loadConfig()` in `src/config.ts`: `sandboxImage`, `sandboxTimeoutMs`, `sandboxMemoryLimit`, `sandboxCpuLimit`, `toolUseMaxIterations`, `ollamaBaseUrl`. Read from env with defaults per design.md. Verify: `tsc --noEmit` passes.
- [x] 8.2 Add pure resolver functions (`resolveSandboxImage`, etc.) and unit test them (same pattern as `resolveLlmProvider`). Verify: config tests pass.

## 9. Docker Deployment

- [x] 9.1 Create `Dockerfile` for the bot: `FROM node:24-alpine`, `apk add docker-cli`, copy `package*.json`, `npm ci --omit=dev`, copy `dist/`, `CMD ["node", "dist/index.js"]`. Verify: `docker build -t telegram-agent-bot .` succeeds.
- [x] 9.2 Create `sandbox/Dockerfile`: `FROM alpine:latest`, `apk add coreutils`, `WORKDIR /work`, `CMD ["sleep", "infinity"]`. Verify: `docker build -t telegram-agent-sandbox ./sandbox` succeeds.
- [x] 9.3 Create `docker-compose.yml` with `bot` and `ollama` services on a shared network (`bot-net`), bot mounts Docker socket, `depends_on: ollama`, both on `bot-net`. Verify: `docker compose config` validates the file.
- [x] 9.4 Create `.dockerignore` excluding `node_modules/`, `.env`, `openspec/`, `.git/`, `test/` (`dist/` deliberately kept out of the ignore list — the bot `Dockerfile` copies a pre-built `dist/` into the image, so ignoring it would break `docker build`; confirmed with user during apply). Verify: file exists.
- [x] 9.5 Add npm scripts to `package.json`: `sandbox:build` (`docker build -t telegram-agent-sandbox ./sandbox`), `docker:up` (checks the sandbox image exists via `scripts/check-sandbox-image.mjs`, then `docker compose up -d --build`), `docker:down` (`docker compose down`), `docker:logs` (`docker compose logs -f`). Verify: `npm run docker:down` runs without error (nothing to stop yet).

## 10. Existing Tests Update

- [x] 10.1 Update `test/orchestrator.test.ts` for the new loop: tests must pass `LlmRequest` to fake `callLlm`, inject a fake `sandboxExecutor` and `toolRegistry`. Keep the one-shot tests (no tools → direct reply) and add loop tests (LLM returns tool call → sandbox executes → LLM returns final answer). Verify: `npm test` passes.
- [x] 10.2 Update `test/llms/ollama.test.ts` for the `/api/chat` endpoint and `LlmRequest` signature. Verify: `npm test` passes.
- [x] 10.3 Update `test/llms/stub.test.ts` for the `LlmRequest` signature. Verify: `npm test` passes.

## 11. New Tests

- [x] 11.1 Create `test/tools/registry.test.ts` — register, retrieve, `isEmpty`, `getDefinitions` returns correct JSON-Schema shapes. Verify: `npm test` passes.
- [x] 11.2 Create `test/tools/execute-command.test.ts` — success (exit 0), failure (exit 1), timeout. Verify: `npm test` passes.
- [x] 11.3 Create `test/tools/read-file.test.ts` and `test/tools/write-file.test.ts` and `test/tools/list-files.test.ts` — each with a fake `execInContainer`. Verify: `npm test` passes.
- [x] 11.4 Create `test/sandbox/sandbox-executor.test.ts` — fake `dockerExec` confirming: sandbox created with correct flags (--read-only, --network none, --memory, --cpus), tool executed via `docker exec`, sandbox removed in `finally` even on error, auto-kill timer fires on timeout. Verify: `npm test` passes. (Also added `test/sandbox/docker-cli.test.ts`, closing a verification gap left by task 3.1.)
- [x] 11.5 Add orchestrator loop tests: (a) LLM answers directly (no tools) → one-shot path, (b) LLM requests one tool → sandbox executes → LLM answers, (c) LLM chains two tool-use iterations → two sandboxes spawned, (d) max iterations reached → failure notice sent, (e) tool execution failure fed back to LLM. Verify: `npm test` passes.
- [x] 11.6 Add orchestrator test: fake `statsRecorder` confirming `recordMessage`, `recordLlmCall`, and `recordToolCall` are called at the right hook points when a `statsRecorder` is provided, and that the loop works normally (no errors) when `statsRecorder` is `undefined`. Verify: `npm test` passes.
- [x] 11.7 Add orchestrator test: `runLoop` is callable directly (without `createMessageHandler` wiring) and returns the expected result for both success and max-iterations cases. Verify: `npm test` passes.

## 12. Documentation

- [x] 12.1 Update `.env.example` with all new env vars and their defaults; note that `OLLAMA_MODEL` must be a tool-capable model (e.g. `qwen2.5`, `llama3.1`). Verify: file contains all new vars.
- [x] 12.2 Update `README.md` — add Docker deployment section (`npm run docker:up` / `docker:down` / `sandbox:build`), document the tool-use loop and new env vars, update the architecture section to mention `src/sandbox/` and `src/tools/`. Verify: README reflects all new functionality.

## 13. Final Verification

- [x] 13.1 Run `npm test` one final time and confirm all tests pass. Verify: `npm test` exits 0.
- [x] 13.2 Run `tsc --noEmit` one final time. Verify: no type errors.
