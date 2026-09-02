# telegram-llm-bot

A Telegram bot that forwards each message to a pluggable LLM connector and replies with the result. There's no Telegram SDK: the Bot API is called directly over HTTPS with Node's built-in `fetch`. Every message is handled independently; no conversation history is kept across messages.

The LLM can request tools (run a shell command, read/write/list files) to answer questions that need computation or filesystem access. Every tool call runs inside an ephemeral, isolated Docker sandbox: read-only root filesystem, no network access, and CPU/memory/time limits. The bot itself runs in its own container and is not sandboxed, since it needs to reach Telegram, Ollama, and the Docker socket.

## Requirements

- Node.js 24.x (current LTS)
- Docker + Docker Compose, for the sandboxed tool-use flow and/or containerized deployment (see [Docker deployment](#docker-deployment))

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in your bot token (get one from [@BotFather](https://t.me/BotFather)):
   ```bash
   cp .env.example .env
   ```

   | Variable | Required | Default | Description |
   | --- | --- | --- | --- |
   | `TELEGRAM_BOT_TOKEN` | yes | n/a | Bot token from @BotFather. Startup fails fast if missing. |
   | `LLM_PROVIDER` | no | `ollama` | Which connector under `src/llms/` to use (`stub` or `ollama`). Startup fails fast if set to anything else. |
   | `LLM_TIMEOUT_MS` | no | `15000` | Max time to wait for an inference call before killing it and reporting a timeout. |
   | `OLLAMA_BASE_URL` | no | `http://ollama:11434` | Only used by the `ollama` connector. This is the Docker network hostname (see [Docker deployment](#docker-deployment)) — for local non-Docker development, set it to `http://127.0.0.1:11434`. |
   | `OLLAMA_MODEL` | no | `qwen2.5` | Only used by the `ollama` connector. **Must be a tool-calling-capable model** (e.g. `qwen2.5`, `llama3.1`, `mistral-nemo`) — `llama3` does not support tool calling. |
   | `SANDBOX_IMAGE` | no | `telegram-agent-sandbox` | Docker image used for the ephemeral tool-execution sandbox. Build it with `npm run sandbox:build`. |
   | `SANDBOX_TIMEOUT_MS` | no | `30000` | Max lifetime of a sandbox container before it is force-stopped. |
   | `SANDBOX_MEMORY_LIMIT` | no | `256m` | `docker run --memory` limit for each sandbox container. |
   | `SANDBOX_CPU_LIMIT` | no | `0.5` | `docker run --cpus` limit for each sandbox container. |
   | `TOOL_USE_MAX_ITERATIONS` | no | `5` | Max think → act → observe iterations per message before giving up. |
   | `STATS_ENABLED` | no | `true` | Records per-message/LLM-call/tool-call stats to a local SQLite database. Set to `false` to disable. |
   | `STATS_DB_PATH` | no | `data/stats.db` | Path to the stats SQLite database (gitignored — local only). |
   | `STATS_STORE_PROMPTS` | no | `true` | Whether prompt/reply text is stored alongside stats. Set to `false` for privacy-sensitive deployments. |
   | `CLASSIFIER_MODEL` | no | `qwen3:1.7b` | Model used to classify each message for routing. Must be pulled in Ollama. A small, text-only Qwen3 model works well here; leave empty to instead auto-select the smallest model discovered from Ollama. See [Model Routing](#model-routing). |
   | `CLASSIFIER_TIMEOUT_MS` | no | `5000` | Max time to wait for the classifier before falling back to `ROUTER_FALLBACK_MODEL`. |
   | `ROUTER_FALLBACK_MODEL` | no | empty (auto) | Model used when the classifier times out, errors, or returns an unrecognized name. Empty auto-selects the largest tool-capable model discovered (or the largest overall). |

   The default connector is `ollama`, so **Ollama must be reachable** (locally via `ollama serve`, or as the `ollama` container — see below) with the configured model already pulled (`ollama pull qwen2.5`, or whatever `OLLAMA_MODEL` you set), or every message will fail with a provider-error reply. Set `LLM_PROVIDER=stub` instead if you just want a placeholder reply with no LLM running.

## Running

```bash
npm run dev      # run from TypeScript source via tsx, for local development
npm run build    # compile to dist/
npm start        # run the compiled build (dist/index.js)
```

Running this way, the bot spawns sandbox containers directly on your local Docker daemon (`OLLAMA_BASE_URL=http://127.0.0.1:11434` and Ollama running locally). For a fully containerized setup, see [Docker deployment](#docker-deployment) below.

## Docker deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for a full runbook (getting started, what runs where, troubleshooting, verifying the tool-use loop). Short version: the bot and Ollama run as separate containers on a shared Docker network (`bot-net`); the bot reaches Ollama at `http://ollama:11434`. The bot container mounts the host's Docker socket so it can spawn ephemeral sandbox containers for tool execution — the bot itself is not sandboxed.

1. Build the sandbox image (the isolated environment tool calls run inside):
   ```bash
   npm run sandbox:build
   ```
2. Set `OLLAMA_MODEL` to a tool-capable model in `.env` (default `qwen2.5`), then start the stack and pull it into the running Ollama container:
   ```bash
   npm run docker:up
   docker compose exec ollama ollama pull qwen2.5
   ```
3. Manage the stack:
   ```bash
   npm run docker:up     # build + start bot and ollama, detached (fails with a clear error if the sandbox image is missing)
   npm run docker:logs   # follow logs from both containers
   npm run docker:down   # stop and remove both containers
   ```

`docker:up` refuses to start if the sandbox image hasn't been built yet, pointing you back to `npm run sandbox:build`.

## Testing

```bash
npm test
```

Uses Node's built-in test runner (`node:test`) and `node:assert`, so there's no test framework dependency. Telegram HTTP calls and the child-process inference boundary are exercised with fakes/fixtures, so tests don't hit the real Telegram API or spawn a real Ollama instance.

## Architecture

- `src/telegram/`: dependency-free Telegram Bot API client (`client.ts`, raw `fetch` calls) and the long-polling loop (`poller.ts`).
- `src/llm/`: the connector plugin contract.
  - `base-connector.ts`: abstract `BaseConnector` class with one method, `callLlm(request: LlmRequest): Promise<LlmResult>`. `LlmRequest` carries the prompt plus optional conversation history, tool definitions, and a model override; `LlmResult` carries the reply text plus optional tool calls and token usage.
  - `connector-registry.ts`: resolves a provider name (`LLM_PROVIDER`) to a connector instance.
  - `inference-runner.ts`: entrypoint executed inside a forked child process; loads a connector and calls it.
  - `inference-caller.ts`: forks `inference-runner`, sends the request over IPC, and enforces a timeout that kills the child if it hangs.
- `src/llms/<provider>/`: one directory per connector implementation. `stub` returns placeholder text and never requests tools; `ollama` calls Ollama's `/api/chat` endpoint and supports native tool calling.
- `src/tools/`: the tool interface and registry. `types.ts` defines `Tool` (`{ name, description, parameters, execute }`) and `ToolContext` (the sandbox-execution environment passed to every tool); `registry.ts` is a `ToolRegistry` that the orchestrator queries for LLM-facing tool definitions and dispatches calls to by name. `execute-command.ts`, `read-file.ts`, `write-file.ts`, `list-files.ts` are the four built-in tools; `index.ts` exports `createDefaultToolRegistry()`, which registers all of them.
- `src/sandbox/`: Docker-backed tool execution. `docker-cli.ts` wraps `child_process.execFile('docker', ...)` with timeout, `AbortSignal`, and stdin support. `sandbox-executor.ts`'s `DockerSandboxExecutor` spawns an ephemeral, read-only, network-isolated container per act step, runs the requested tool calls sequentially inside it via `docker exec`, and tears it down in a `finally` block (with an auto-kill timer as a backstop).
- `src/orchestrator.ts`: runs a think → act → observe loop per message. `runLoop()` sends the conversation + available tool definitions to the LLM; if the LLM requests tool calls, they're executed in a fresh sandbox and the results are fed back, repeating until a final text answer or `TOOL_USE_MAX_ITERATIONS` is reached. `createMessageHandler()` wires this to a Telegram message and reply; when no tools are registered, the loop exits after the first LLM call — the same one-shot behavior as before tool-use existed. No state is kept between messages.
- `src/logger.ts` / `src/error-handlers.ts`: colorized console logging and top-level exception/rejection capture.
- `src/stats/`: `SqliteStatsRecorder` implements the orchestrator's `StatsRecorder` hook using `node:sqlite`, writing to `data/stats.db` (gitignored). `reporter.ts`'s `StatsReporter` queries that database and renders a Markdown report; `reporter-cli.ts` is the `npm run stats:report` entrypoint. See [Statistics](#statistics).
- `src/routing/`: dynamic model discovery and classifier-based routing. See [Model Routing](#model-routing).

Each inference call runs in its own child process (see `inference-caller.ts`), so a connector that hangs, crashes, or throws can never block or take down the bot process. The parent kills the child on timeout and reports a typed failure instead. Tool execution has an analogous isolation boundary one level down: each act step runs in its own disposable Docker container, so a tool call can never touch the bot's own filesystem, network, or process.

The orchestrator logs the text of each incoming message and, on success, the LLM's reply text, so `npm run dev` shows the actual conversation as it happens:

```
[INFO] Message received { chatId: 123, prompt: 'hi' }
[INFO] Inference succeeded, sending reply { chatId: 123, reply: '...' }
```

This log output is console-only. Structured stats (token usage, latency, tool calls) are persisted separately — see [Statistics](#statistics) below. Be mindful of what's visible in your terminal if a chat contains sensitive text.

## Model Routing

Each incoming message can be routed to a different Ollama model depending on how simple or complex it is — e.g. a small model for "hi", a larger tool-capable model for "write a script and run it".

**Discovery.** At startup, the bot queries Ollama's `/api/tags` (list of pulled models) and `/api/show` (per-model capabilities, including tool-call support, and parameter size) at `OLLAMA_BASE_URL`. This happens once, not per message — pull new models with `ollama pull` and restart the bot to pick them up. If Ollama is unreachable at startup, this is logged as a warning and routing is skipped (the connector's default `OLLAMA_MODEL` is used for every message), not a startup failure.

**Auto-selection.** From the discovered models, the bot picks:
- **Classifier model** — `CLASSIFIER_MODEL` (default `qwen3:1.7b`, a small text-only model). Leave the variable empty to instead auto-select the smallest discovered model by parameter size.
- **Fallback model** — the largest model that supports tool calling, or the largest overall if none do (`ROUTER_FALLBACK_MODEL` to override).

Routing is skipped entirely when fewer than two models are discovered — with only one model available, there's nothing to route between.

**Per-message classification.** Before the think → act → observe loop runs, the classifier model is asked to pick which available model should handle the message (given the message text and each candidate's name, parameter size, and tool support). The chosen model is then used for the actual reply. The classifier call always disables "thinking" mode (`think: false`) — its response is parsed as a bare model name, and a thinking model's reasoning trace would break that match.

**Fallback.** If the classifier call times out (`CLASSIFIER_TIMEOUT_MS`, default 5000ms — shorter than `LLM_TIMEOUT_MS` so a slow classification doesn't delay the reply beyond that), errors, or returns a name that isn't in the discovered model list, the fallback model is used instead. This is expected to happen occasionally and never blocks a reply.

**Observability.** Every routing decision is logged (`Routing decision`, with the chosen model, `source` — `"classifier"` or `"fallback"` — and `reason` on fallback) and, when stats are enabled, the classifier call itself is recorded in `llm_calls` with `role="classifier"` (see [Statistics](#statistics)) — so you can see how often the classifier is used vs. falling back, and how many tokens classification costs relative to the main loop.

## Statistics

When `STATS_ENABLED` is `true` (the default), every processed message, LLM call, and tool call is recorded to a local SQLite database (`STATS_DB_PATH`, default `data/stats.db`) via `src/stats/`. This is zero-dependency — it uses Node's built-in `node:sqlite`. The `data/` directory is gitignored: this data is local-only and never committed, since it can include prompt/reply text (see `STATS_STORE_PROMPTS` to disable that).

Recorded per message: timestamp, chat ID, latency, iteration count, tool-call count, success/failure (with reason). Per LLM call: model, prompt/completion tokens (from the provider's real usage counts when available), latency, role (`main` for the think → act → observe loop, `classifier` for a routing decision — see [Model Routing](#model-routing)), success/failure. Per tool call: tool name, arguments, latency, success/failure, result length.

Generate a Markdown report from the recorded data:

```bash
npm run stats:report
```

This reads `STATS_DB_PATH` and writes `data/stats-report.md` with per-model token totals, a per-role token breakdown, average latency per model, overall success rate, and a tool-usage summary. Running it against an empty database produces a report that says "No data" rather than failing.

The database schema is versioned via SQLite's `PRAGMA user_version`. Both the recorder and the reporter run `migrate()` (`src/stats/migrations.ts`) on every open, applying any pending migrations in order and preserving existing rows — there's no need to delete `data/stats.db` when the schema changes. To change the schema, append a new `{ version: N, up: (db) => ... }` entry to the `MIGRATIONS` array in `src/stats/migrations.ts` (an `ALTER TABLE`, an additional `CREATE TABLE`, etc.) rather than editing `schema.sql` in place; each pending migration runs exactly once, inside its own transaction, which rolls back if the migration throws.

For live dashboards instead of static reports, point Grafana's [SQLite datasource plugin](https://grafana.com/grafana/plugins/frser-sqlite-datasource/) at `data/stats.db` directly — this is optional and not set up by default.

## Adding a new LLM connector

1. Create a new directory under `src/llms/<your-provider>/` with an `index.ts` exporting a class that extends `BaseConnector` and implements `callLlm(request: LlmRequest): Promise<LlmResult>`. If the provider supports tool calling, read `request.tools` and return requested calls as `result.toolCalls`; if not, ignore `request.tools` and always return text-only results (see `src/llms/stub/index.ts`).
2. Register it in `src/llm/connector-registry.ts`'s `CONNECTOR_FACTORIES` map, keyed by the name you'll use for `LLM_PROVIDER`. Startup validation (`config.ts`) automatically accepts this new name, since it's derived from the same map rather than a separate list.
3. Set `LLM_PROVIDER=<your-provider>` in `.env`.

No changes are needed anywhere else: the runner, caller, and orchestrator only ever depend on the `BaseConnector` contract.

## Adding a new tool

1. Create a new file under `src/tools/` exporting a `Tool` (`{ name, description, parameters, execute(context, args) }`). `parameters` is the JSON Schema advertised to the LLM; `execute` runs inside the sandbox via `context.execInContainer(command, stdin?)` and returns a `ToolResult` (`{ ok, output?, error? }`).
2. Register it in `createDefaultToolRegistry()` in `src/tools/index.ts`.

No orchestrator or sandbox changes are needed: the registry is the only thing that knows which tools exist.
