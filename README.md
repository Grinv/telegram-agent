# telegram-llm-bot

A Telegram bot that forwards each message to a pluggable LLM connector and replies with the result. There's no Telegram SDK: the Bot API is called directly over HTTPS with Node's built-in `fetch`. Every message is handled independently; no conversation history is kept across messages.

The LLM can request tools (run a shell command, read/write/list files) to answer questions that need computation or filesystem access. Every tool call runs inside an ephemeral, isolated Docker sandbox: read-only root filesystem, CPU/memory/time limits, and — by default — no network access at all. Network access can optionally be relaxed to outbound-only (see [Sandbox network modes](#sandbox-network-modes)). The bot itself runs in its own container and is not sandboxed, since it needs to reach Telegram, Ollama, and the Docker socket.

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
   | `SANDBOX_NETWORK` | no | `isolated` | `isolated` (default) gives sandboxes no network access; `egress` allows outbound requests. Switching to `egress` requires rebuilding the sandbox image first. See [Sandbox network modes](#sandbox-network-modes). |
   | `SANDBOX_NETWORK_NAME` | no | `telegram-agent-sandbox-net` | Dedicated Docker network sandboxes attach to in `egress` mode. Created automatically on first use. |
   | `TOOL_USE_MAX_ITERATIONS` | no | `5` | Max think → act → observe iterations per message before giving up. |
   | `STATS_ENABLED` | no | `true` | Records per-message/LLM-call/tool-call stats to a local SQLite database. Set to `false` to disable. |
   | `STATS_DB_PATH` | no | `data/stats.db` | Path to the stats SQLite database (gitignored — local only). |
   | `STATS_STORE_PROMPTS` | no | `true` | Whether prompt/reply text is stored alongside stats. Set to `false` for privacy-sensitive deployments. |
   | `PRICE_TABLE_PATH` | no | `prices.json` | JSON file mapping model name to price per million input/output tokens, used to compute each LLM call's estimated cost. A missing file means every model is recorded as unpriced. See [Statistics](#statistics). |
   | `CLASSIFIER_MODEL` | no | `qwen3:1.7b` | Model used to classify each message for routing. Must be pulled in Ollama. A small, text-only Qwen3 model works well here; leave empty to instead auto-select the smallest model discovered from Ollama. See [Model Routing](#model-routing). |
   | `CLASSIFIER_TIMEOUT_MS` | no | `5000` | Max time to wait for the classifier before falling back to `ROUTER_FALLBACK_MODEL`. |
   | `ROUTER_FALLBACK_MODEL` | no | empty (auto) | Model used when the classifier times out, errors, or returns an unrecognized name. Empty auto-selects the largest tool-capable model discovered (or the largest overall). |
   | `TOOL_RESULT_MAX_BYTES` | no | `8000` | Max size (characters) a tool result may reach before it is truncated. A truncated result keeps the beginning and end and states it was truncated and how large the original was — see [Context management](#context-management). |
   | `CONVERSATION_COMPACTION_THRESHOLD` | no | `4000` | Estimated-token size above which a chat's stored conversation is sent compacted (recent turns intact, a summary in place of earlier ones) rather than in full. The stored conversation itself is never affected. See [Context management](#context-management). |

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

`docker:up` refuses to start if the sandbox image hasn't been built yet, pointing you back to `npm run sandbox:build`. To run the [benchmark](#benchmark) against this deployment, see its Compose-specific instructions there — Ollama isn't reachable from the host in this setup.

There's also an **isolated deployment**, where the bot itself (not just its tool sandboxes) runs inside a hardware-isolated microVM managed by Docker Sandboxes (`sbx`), reachable from the host through nothing but two explicit port grants and a token-holding broker process. It's optional and requires macOS on Apple Silicon; see [DEPLOYMENT.md](DEPLOYMENT.md#isolated-deployment-microvm-boundary) for setup and the full rationale.

## Sandbox network modes

`SANDBOX_NETWORK` controls what network access tool-execution sandboxes get. There are two modes:

- **`isolated` (default)** — sandbox containers get no network access at all (`--network none`). Tools that need to call an HTTP API cannot run at all. This matches the tool-use sandbox's original behavior exactly.
- **`egress`** — sandbox containers are attached to a dedicated network (`SANDBOX_NETWORK_NAME`, created automatically on first use) so tools can make outbound HTTP requests. In this mode, the agent's own containers — the LLM provider (`ollama`) and the bot itself — are **not** reachable from the sandbox, since they live on a different network (`bot-net`), and the Docker socket is never mounted into the sandbox in either mode. Enabling `egress` requires rebuilding the sandbox image first (`npm run sandbox:build`), since it's what installs the HTTP client (`curl`) the mode is meant to make useful.

**Residual risk**: in `egress` mode, a container on a bridge-style Docker network can typically still address the host machine itself through the Docker gateway IP, and so could reach any service the host has bound to a network interface (for example, a locally-run Ollama on port `11434`). This is not mitigated within the regular Docker deployment — it's the reason `egress` is opt-in and off by default there. It **is** mitigated when running the [isolated (microVM) deployment](DEPLOYMENT.md#isolated-deployment-microvm-boundary): there, the "host" a sandbox can address is the isolation boundary itself, not the operator's machine, and the boundary's own egress is default-deny with explicit per-host grants — so a sandbox in `egress` mode still can't reach anything that wasn't already allowed one level up. Treat `egress` mode as something to enable inside that boundary, where its blast radius is bounded; enabling it on a bare Docker host means accepting that a sandboxed command can reach host-bound services, which should be a deliberate choice for a development machine rather than a default posture.

## Context management

Several limits bound what enters a request to the model, so a single message never resends or reads more than it needs:

- **Tool results are bounded** (`TOOL_RESULT_MAX_BYTES`, default 8000 characters). A tool result over the limit is truncated — keeping the beginning and, where there's room, the end — and states in its own text that it was truncated and how large the original was, so the model can tell a partial result from a complete one and ask for a narrower one if needed. A result within the limit is returned unchanged.
- **File reads can be bounded to a range** — `read_file` accepts optional `start_line`/`end_line` arguments (1-indexed, inclusive, must be given together) to read part of a file instead of the whole thing. A range starting past the end of the file reports the file's length rather than failing.
- **Long conversations are compacted** (`CONVERSATION_COMPACTION_THRESHOLD`, default 4000 estimated tokens). Once a chat's stored history exceeds this size, the request sent to the model carries the most recent turns intact and a summary (produced by its own LLM call) in place of the earlier ones. The **stored** conversation is never affected — `/new` remains the only thing that clears it. This is a bound on unbounded chat growth, not something the benchmark or typical usage is expected to trigger regularly (see `openspec/changes/add-token-optimizations/notes.md`, once archived `openspec/changes/archive/`, for the measured basis of the default).
- **The request prefix is stable** — the agent's instructions, the skill index, and the advertised tool definitions are assembled identically on every call (byte-identical, aside from a configuration change like adding a skill), so a provider able to reuse a repeated prompt prefix is not prevented from doing so by incidental variation. **This benefit is not directly measurable here**: Ollama reports no cache-hit statistics, so there is no number to attribute a saving to on this deployment — the requirement is kept because it costs nothing and is correct regardless, not because a measured figure backs it.

### Shell-output compression (RTK)

`execute_command`'s output is additionally routed through [RTK](https://github.com/rtk-ai/rtk) (`rtk pipe`, run inside the sandbox) before the tool-result limit above is applied, so verbose command output is filtered/deduplicated/summarized rather than truncated blindly. A compressed result states that it was compressed, so it's never mistaken for the command's verbatim output; if RTK is unavailable or errors, the tool silently falls back to the raw (still limit-bounded) output rather than failing the call.

**Requires an amd64 sandbox image.** RTK ships no musl build for arm64 Linux, and its glibc (`gnu`) arm64 build does not run on musl-based `alpine` even with `gcompat` installed (confirmed: `fcntl64`/`__res_init` fail to relocate). `npm run sandbox:build` therefore fails fast with a clear error on an arm64 host. To build an amd64 image anyway (e.g. from an Apple Silicon dev machine, for a deployment target that is amd64), use buildx directly:
```bash
docker buildx build --platform linux/amd64 --pull -t telegram-agent-sandbox ./sandbox
```
On an arm64 host without this, `execute_command` output still goes through the tool-result limit unmodified — only the RTK compression step is skipped.

## Testing

```bash
npm test
```

Uses Node's built-in test runner (`node:test`) and `node:assert`, so there's no test framework dependency. Telegram HTTP calls and the child-process inference boundary are exercised with fakes/fixtures, so tests don't hit the real Telegram API or spawn a real Ollama instance.

## Architecture

- `src/telegram/`: dependency-free Telegram Bot API client (`client.ts`, raw `fetch` calls) and the long-polling loop (`poller.ts`).
- `src/llm/`: the connector plugin contract.
  - `base-connector.ts`: abstract `BaseConnector` class with one method, `callLlm(request: LlmRequest): Promise<LlmResult>`. `LlmRequest` carries the prompt plus optional conversation history, tool definitions, a model override, and optional sampling controls (temperature/seed) for reproducible generation, used by the [benchmark](#benchmark) — absent by default, leaving ordinary requests untouched; `LlmResult` carries the reply text plus optional tool calls and token usage.
  - `connector-registry.ts`: resolves a provider name (`LLM_PROVIDER`) to a connector instance.
  - `inference-runner.ts`: entrypoint executed inside a forked child process; loads a connector and calls it.
  - `inference-caller.ts`: forks `inference-runner`, sends the request over IPC, and enforces a timeout that kills the child if it hangs.
- `src/llms/<provider>/`: one directory per connector implementation. `stub` returns placeholder text and never requests tools; `ollama` calls Ollama's `/api/chat` endpoint and supports native tool calling.
- `src/skills/`: agent skills — reusable instruction sets the model can request. `index.ts`'s `loadSkills(dir)` loads `*.md` files from a configured directory at startup; each skill file has front matter (`name`, `description`) and a body. The skill index (names and descriptions only) is advertised to the model on every request, and the `read_skill` tool lets the model fetch a skill's full body on demand. See [Agent Skills](#agent-skills).
- `src/tools/`: the tool interface and registry. `types.ts` defines `Tool` (`{ name, description, parameters, execute }`) and `ToolContext` (the sandbox-execution environment passed to every tool — `execInContainer`, plus optional `callLlm`/`runLoop`/`toolRegistry`/`sandboxExecutor`/`router`/`statsRecorder`/`maxSubagents`/`maxSubIterations` for tools that start nested loops); `registry.ts` is a `ToolRegistry` that the orchestrator queries for LLM-facing tool definitions and dispatches calls to by name (`without(names)` returns a copy excluding given tools). `execute-command.ts`, `read-file.ts`, `write-file.ts`, `list-files.ts` are the four built-in tools; `spawn-subagent.ts`/`spawn-subagents.ts` add parallel sub-agent tools (see [Parallel Subagents](#parallel-subagents)). `index.ts` exports `createDefaultToolRegistry()` (the four built-ins) and `createSubagentToolRegistry(context)` (built-ins plus the spawn tools, when `context` has what they need).
- `src/sandbox/`: Docker-backed tool execution. `docker-cli.ts` wraps `child_process.execFile('docker', ...)` with timeout, `AbortSignal`, and stdin support. `sandbox-executor.ts`'s `DockerSandboxExecutor` spawns an ephemeral, read-only container per act step — with no network access by default, or attached to a dedicated egress network per `SANDBOX_NETWORK` (see [Sandbox network modes](#sandbox-network-modes)) — runs the requested tool calls sequentially inside it via `docker exec`, and tears it down in a `finally` block (with an auto-kill timer as a backstop). Its constructor takes an optional `extraContext` object that's merged into every per-call `ToolContext` alongside `execInContainer` — this is how `callLlm`/`runLoop`/etc. reach `spawn_subagent`.
- `src/orchestrator.ts`: runs a think → act → observe loop per message. `runLoop()` sends the conversation + available tool definitions to the LLM; if the LLM requests tool calls, they're executed in a fresh sandbox and the results are fed back, repeating until a final text answer or `TOOL_USE_MAX_ITERATIONS` is reached. `createMessageHandler()` wires this to a Telegram message and reply; when no tools are registered, the loop exits after the first LLM call — the same one-shot behavior as before tool-use existed. No state is kept between messages.
- `src/logger.ts` / `src/error-handlers.ts`: colorized console logging and top-level exception/rejection capture.
- `src/stats/`: `SqliteStatsRecorder` implements the orchestrator's `StatsRecorder` hook using `node:sqlite`, writing to `data/stats.db` (gitignored). `reporter.ts`'s `StatsReporter` queries that database and renders the aggregate Markdown report (`reporter-cli.ts`, `npm run stats:report`) plus three dashboard views built on the read-only queries in `dashboard-queries.ts` and rendered by `dashboard-views.ts`: summary (`summary-cli.ts`), timeline (`timeline-cli.ts`), and analysis (`analysis-cli.ts`). See [Statistics](#statistics).
- `src/routing/`: dynamic model discovery and classifier-based routing. See [Model Routing](#model-routing).
- `benchmark/`: a fixed set of tasks run against the real agent to measure tokens/cost/turns/tool-calls and correctness, independent of `src/`. See [Benchmark](#benchmark).

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

## Parallel Subagents

For a task with independent sub-parts (e.g. "summarize these 3 files"), the LLM can decompose it instead of working through every part sequentially in one loop:

- **`spawn_subagent({ task, model? })`** — runs a fresh think → act → observe loop (`runLoop`) with its own sandbox for one independent sub-task, and returns that sub-agent's final answer as the tool result.
- **`spawn_subagents({ tasks: [...], model? })`** — runs one `spawn_subagent` per task, concurrently, in batches of `MAX_SUBAGENTS` (default 3) so no more than that many sandboxes exist at once; if `tasks.length` exceeds the limit, later batches start only once the current batch finishes. Each sub-agent's success/failure is reported individually (a failed one shows up as `[failed: <reason>]` in the results array) rather than failing the whole call.

**Recursion guard.** A sub-agent's own tool registry is the parent's registry with `spawn_subagent`/`spawn_subagents` excluded (`ToolRegistry.without([...])`), so a sub-agent can never spawn further sub-agents — there's no unbounded nesting to bound.

**Iteration cap.** Each sub-agent's own loop is capped by `MAX_SUB_ITERATIONS` (default 3), independent of and lower than the parent's `TOOL_USE_MAX_ITERATIONS`, to bound how long a single sub-task can run.

**These are just tools.** `spawn_subagent`/`spawn_subagents` are registered in the `ToolRegistry` like any other tool (`execute_command`, `read_file`, ...) — the orchestrator itself is not modified and has no special knowledge of subagents. The parent LLM decides whether to use them on any given think → act → observe iteration, exactly as it decides to use any other tool.

**Observability.** Every sub-agent LLM call is recorded in stats with `role="subagent"` (alongside `"main"` for the top-level loop and `"classifier"` for routing decisions — see [Model Routing](#model-routing) and [Statistics](#statistics)), so the stats report's per-role token breakdown shows sub-agent token spend separately from the parent conversation. Each concurrently-running sub-agent additionally gets its own `agent_id` (`subagent-0`, `subagent-1`, ...), since several sub-agents sharing `role="subagent"` would otherwise be indistinguishable from each other. Sub-agent tool calls are recorded under the parent message's `message_id`, so total cost per message includes everything its sub-agents did.

## Agent Skills

Skills are authored instruction sets that extend what the LLM can do without writing code. Each skill is a Markdown file with structured front matter and a body containing detailed step-by-step guidance.

**Format.** A skill file starts with `---` on the first line, followed by front matter with two required fields (`name` and `description`), then `---` again, and finally the body:

```markdown
---
name: weather
description: Look up current weather conditions for a city using the wttr.in service.
---
This skill fetches current weather conditions from wttr.in, a free plain-text weather service...
```

The `name` must be unique across all loaded skills. Names are used when the model requests a skill via the `read_skill` tool.

**Discovery and loading.** Skills are loaded once at startup from the `SKILLS_DIR` directory (default `skills`, configurable via the `SKILLS_DIR` environment variable). The bot reads every `*.md` file directly in that directory (non-recursive), parses its front matter, and makes them available. Skills cannot be created, edited, or deleted while the bot is running — a human edits the files in `skills/` and restarts the bot for changes to take effect.

**Advertised to every message.** On each incoming message, the model receives the complete skill index (every loaded skill's `name` and `description`, formatted as a simple list) in the system instruction. This index helps the model know what skills are available and when to use them, without spending context tokens on the full body of every skill.

**On-demand fetching.** When the model wants to use a skill, it calls the `read_skill` tool with the skill's exact name. This returns the skill's full body — the instructions that guide execution. Skill bodies are never sent preemptively; they're fetched only when a specific message needs them. This keeps context usage low and focused.

**Shipped skills.** Two example skills are included:

- **`weather`** — fetches current weather conditions for a location using `curl` and the wttr.in service. Returns formatted conditions (temperature, "feels like", humidity, wind) in a single line that can be read directly into a reply.
- **`morning-briefing`** — a multi-step routine that combines the current date/time, weather conditions, and a joke into one coherent morning briefing message. Demonstrates how to compose multiple tool calls (shell commands and external API calls) and synthesize their results into a natural-language response.

## Statistics

When `STATS_ENABLED` is `true` (the default), every processed message, LLM call, and tool call is recorded to a local SQLite database (`STATS_DB_PATH`, default `data/stats.db`) via `src/stats/`. This is zero-dependency — it uses Node's built-in `node:sqlite`. The `data/` directory is gitignored: this data is local-only and never committed, since it can include prompt/reply text (see `STATS_STORE_PROMPTS` to disable that).

Recorded per message: timestamp, chat ID, latency, iteration count, tool-call count, success/failure (with reason). Per LLM call: timestamp, model, the specific agent that made it (`agent_id` — e.g. `main`, `classifier`, `subagent-0`, `subagent-1`; distinguishes concurrent sub-agents, unlike `role` which only says what kind), input/output tokens plus cached/reasoning tokens where the provider reports them (from the provider's real usage counts — never estimated; a count the provider never reports is recorded as `0` and flagged `usage_detail_reported = 0` so it isn't mistaken for a measured zero), latency, an estimated cost (see below), how the call's input divides across five content categories (the agent's instructions, the definitions of the tools advertised to the model — generated from the registered tools, distinct from the hand-authored instruction text — the user's request, prior conversation, and tool output — always summing to the call's input tokens, including content such as the tool definitions that travels outside the message list), how much of that input — including the tool definitions — was already sent in an earlier call of the same task vs is new, role (`main` for the think → act → observe loop, `classifier` for a routing decision — see [Model Routing](#model-routing)), success/failure. A row's `attribution_version` marks whether its category and repeated-input figures were computed with tool definitions included (`1`) or under the previous, tool-definition-blind attribution (`0`, including every row recorded before this field existed) — the two are never averaged together in an aggregate (see Dashboard views below). Per tool call: tool name, arguments, measured duration (never a placeholder zero), success/failure, argument size, result size (both in characters and, since tool output isn't tokenized by the provider, an estimated token count — see `src/stats/token-estimate.ts`).

**Estimated cost.** Each LLM call's cost is computed from its token counts and a per-model price read from `PRICE_TABLE_PATH` (default `prices.json`, gitignored — copy the shape from `.env.example`'s comment) and stored on the row at record time, so a later price change never rewrites the cost of past calls. A model absent from the price table is recorded with cost `0` and flagged `priced = 0`, distinguishing "unpriced" from a genuinely free call. With a local provider (Ollama) real spend is zero, so populate the price table with the rates of comparable hosted models — the resulting figures are a proxy for relative spend (useful for comparing "before" vs "after" an optimization), not an actual bill.

Generate a Markdown report from the recorded data:

```bash
npm run stats:report
```

This reads `STATS_DB_PATH` and writes `data/stats-report.md` with per-model token totals, a per-role token breakdown, average latency per model, overall success rate, and a tool-usage summary. Running it against an empty database produces a report that says "No data" rather than failing.

**Dashboard views.** Three further views, built on `src/stats/dashboard-queries.ts`, answer questions the report above can't:

```bash
npm run stats:summary            # data/stats-summary.md
npm run stats:timeline -- <id>   # data/stats-timeline-<id>.md
npm run stats:analysis           # data/stats-analysis.md
```

- **Summary** (`stats:summary`) — tasks completed, input/output/cached token totals, estimated cost, per-task averages (tokens, turns, tool calls), and tools ranked by their share of tokens. "What does an average task cost?"
- **Timeline** (`stats:timeline -- <id>`) — one task's turns in order, each with its LLM token count and the tool calls made in that turn with their result sizes. `<id>` is a `messages.id` row (e.g. from browsing `data/stats.db` directly, or from another view's output). An unknown id produces a "Task not found" file rather than failing. "Why did this one run cost what it did?"
- **Analysis** (`stats:analysis`) — tools ranked by token share, the single most expensive turn, input broken down by content category (instructions / tool definitions / user request / conversation / tool output), and how much input was repeated vs. new. Both breakdowns are measured over the whole request, including the tool definitions advertised to the model — a block resent unchanged on every call, often the largest single share of input — and are reported only over rows recorded under the current attribution (`attribution_version = 1`); rows from before this field existed, or from before tool definitions were attributed, are excluded from these two breakdowns rather than averaged in as though they were the same measurement (`excludedRows`). "Which tools and which kind of content are driving token spend?"

All three, like the report above, run against an empty database without failing. Where a figure was never actually measured — no provider in the data reported cache statistics, a model has no configured price, or a row predates the column that field lives in — the view says so explicitly (`unavailable`, or a `(partial — ...)` / "excluded" note) rather than showing a zero or averaging in a migration default as if it were an observation.

The database schema is versioned via SQLite's `PRAGMA user_version`. Both the recorder and the reporter run `migrate()` (`src/stats/migrations.ts`) on every open, applying any pending migrations in order and preserving existing rows — there's no need to delete `data/stats.db` when the schema changes. To change the schema, append a new `{ version: N, up: (db) => ... }` entry to the `MIGRATIONS` array in `src/stats/migrations.ts` (an `ALTER TABLE`, an additional `CREATE TABLE`, etc.) rather than editing `schema.sql` in place; each pending migration runs exactly once, inside its own transaction, which rolls back if the migration throws.

For live dashboards instead of static reports, point Grafana's [SQLite datasource plugin](https://grafana.com/grafana/plugins/frser-sqlite-datasource/) at `data/stats.db` directly — this is optional and not set up by default.

**Exporting traces (OpenTelemetry).** Setting `OTEL_EXPORTER_OTLP_ENDPOINT` (unset by default) additionally emits the same recorded activity as an [OpenTelemetry](https://opentelemetry.io/) trace, exported over OTLP/HTTP to that endpoint: one span per handled message, a child span per LLM call, and a child span per tool call, each carrying the measurements described above (model, tokens, latency, estimated cost, category split, repetition, tool name/sizes/duration) under OpenTelemetry's GenAI semantic conventions where they apply. A sub-agent's LLM-call spans nest under the tool call (`spawn_subagent`/`spawn_subagents`) that spawned them, so a trace shows what one message cost in total and where. `STATS_STORE_PROMPTS` governs the exported spans exactly as it governs the local database: with it `false`, prompt/reply text never leaves the machine.

With no endpoint configured — the shipped default — nothing is exported, no OpenTelemetry SDK is started, and no collector needs to be running: the agent behaves exactly as it does without this feature. The local SQLite database (above) is unaffected either way and remains the source of truth the benchmark reads. An unreachable, slow, or misbehaving export destination never delays a reply or blocks local recording — failures are logged (once per down/recovered transition, not once per span) and otherwise swallowed. `docker-compose.yml` includes an optional, not-started-by-default `otel-collector` service (`docker compose --profile otel-collector up`) for operators who want somewhere local to point this at.

## Benchmark

Statistics (above) tell you what the agent *did* cost. The benchmark (`benchmark/`, see [benchmark/README.md](benchmark/README.md)) exists to answer a different question: when a change is meant to *reduce* token consumption, did it actually fall, and did the agent's answers get worse in the process? "The run didn't error" is not the same claim as "the answer was right" — an optimization that truncates tool output aggressively can keep completing runs while quietly answering wrong, and that would look free by the statistics above.

**The task set.** `benchmark/tasks.ts` defines a fixed set of tasks, each a message (or, for the multi-turn task, a short sequence of messages) plus a mechanical correctness check — never a model's judgement, so the check itself can't drift between runs. The set spans the ways tokens get spent: a no-tools factual question, a shell command, reading a file, a skill (`benchmark/skills/word-count.md`, a benchmark-only skill kept separate from the bot's real `skills/`), sub-agent decomposition, and a multi-turn exchange that relies on conversation history. **The set is frozen once a baseline snapshot exists** — see [benchmark/README.md](benchmark/README.md) for why, and don't edit `benchmark/tasks.ts` or `benchmark/skills/word-count.md` after that point.

**Running it.** Requires a real LLM provider reachable the same way the bot itself reaches one (e.g. Ollama with a tool-capable model pulled) and Docker for the tool-use sandbox — it is not run in CI and does not participate in `npm test`.

For local, non-Docker development (`OLLAMA_BASE_URL=http://127.0.0.1:11434`, see [Running](#running)):

```bash
npm run benchmark:run -- <label>               # runs the task set, saves data/benchmark-snapshots/<label>.json
npm run benchmark:compare -- <before> <after>  # compares two labelled snapshots
```

For a [Docker deployment](#docker-deployment), Ollama is only reachable on the internal `bot-net` network, not from the host — run the benchmark as its own Compose service instead, which joins that network and shares `.env` and `./data` with the bot the same way it does:

```bash
npm run benchmark:docker:build                          # builds the benchmark image (rebuild after benchmark/ or src/ changes)
npm run benchmark:docker:run -- <label>                  # runs the task set inside bot-net
docker compose run --rm benchmark node --import tsx benchmark/compare-cli.ts <before> <after>
```

The `benchmark` service (`docker-compose.yml`) is gated behind the `benchmark` [Compose profile](https://docs.docker.com/compose/how-tos/profiles/), so plain `docker compose up`/`down` never builds or starts it.

Every task runs `BENCHMARK_REPETITIONS` times (default `3`) — a single run of a non-deterministic system is an anecdote, so correctness is reported over repetitions. Each run pins a single model (`BENCHMARK_MODEL`, default `OLLAMA_MODEL` or `llama3`) with routing disabled, requests deterministic sampling from the provider (`BENCHMARK_TEMPERATURE` default `0`, `BENCHMARK_SEED` default `42` — this narrows variance, it does not guarantee determinism, which is why repetitions exist regardless), and gives every task a fresh, empty conversation history so no task inherits another's context. Benchmark activity is recorded to its own SQLite database (`BENCHMARK_STATS_DB_PATH`, default `data/benchmark-stats.db`), never the one real usage writes to (`STATS_DB_PATH`) — this is also where each execution's tokens, cost, turns and tool calls are read back from after it runs, including whatever its sub-agents did (the orchestrator already attributes sub-agent activity to the same message — see [Parallel Subagents](#parallel-subagents)).

| Variable | Default | Description |
| --- | --- | --- |
| `BENCHMARK_MODEL` | `OLLAMA_MODEL` or `llama3` | The single model every task in the run is pinned to. |
| `BENCHMARK_REPETITIONS` | `3` | How many times each task is run within one benchmark run. |
| `BENCHMARK_TEMPERATURE` | `0` | Sampling temperature requested from the provider for every call in the run. |
| `BENCHMARK_SEED` | `42` | Sampling seed requested from the provider for every call in the run. |
| `BENCHMARK_STATS_DB_PATH` | `data/benchmark-stats.db` | The benchmark's own stats database — separate from `STATS_DB_PATH`. |
| `BENCHMARK_SNAPSHOT_DIR` | `data/benchmark-snapshots` | Where labelled snapshots are written/read. |
| `BENCHMARK_SKILLS_DIR` | `benchmark/skills` | Skills loaded for the benchmark run — separate from the bot's `SKILLS_DIR`. |

**Snapshots.** A completed run is saved as `<BENCHMARK_SNAPSHOT_DIR>/<label>.json` (gitignored, like everything under `data/`), recording per execution: task id and kind, correctness verdict, input/output tokens, estimated cost, turns, and tool calls — plus the conditions the run was produced under (the pinned model, and an identifier for the task set that changes whenever `benchmark/tasks.ts` changes).

**Comparing two snapshots.** `npm run benchmark:compare -- <before> <after>` reports the change in tokens, estimated cost, and correctness rate, both overall and per task, each stated as a direction and magnitude — written to `data/benchmark-compare-<before>-vs-<after>.md`. A task whose correctness rate drops is called out individually (`regressedTasks`), so a regression concentrated in one task is visible even when it barely moves the overall rate. If the two snapshots used different models, or were produced from different task sets (i.e. `benchmark/tasks.ts` was edited between them), the comparison refuses to diff them — presenting that difference as though it were the effect of a change would be actively misleading, not just unhelpful.

**Cost figures are proxies, not spend.** With a local provider (Ollama) real spend is zero; `PRICE_TABLE_PATH` (see [Statistics](#statistics)) holds the rates of comparable hosted models instead. The proportional change between two snapshots' estimated cost is meaningful for comparing "before" vs. "after" an optimization; the absolute figures are not an actual bill.

### Token optimizations: before/after

The [Context management](#context-management) limits above were measured against this benchmark, model `qwen2.5`, `BENCHMARK_REPETITIONS=5` to match the baseline. **Cost figures throughout are a proxy** computed from the rates of a comparable hosted model (`prices.json`, ~$0.15/$0.60 per million input/output tokens) — Ollama runs `qwen2.5` locally and spends nothing; the dollar figures below are for relative comparison only, never a bill (see `openspec/changes/add-token-optimizations/notes.md`, once archived `openspec/changes/archive/`, for the full rate rationale).

| Snapshot | Tokens | vs. baseline | Correctness |
| --- | ---: | ---: | ---: |
| `baseline` | 50303 | — | 30/30 (100%) |
| Sections 7.1+7.4 alone (not shipped in isolation — see below) | 38045 | −24.4% | 25/30 (83.3%) |
| **All optimizations combined (as shipped)** | 47430 | **−5.7%** | **30/30 (100%)** |

**Result: a 5.7% reduction, correctness fully held — short of the 30% target.** No task regressed in the combined, as-shipped snapshot. What limited the reduction:

- **Five of the seven candidates measure at or near zero on this benchmark by design**, not by omission: tool-result limits and bounded file reads bound failure modes this small, checkable task set never triggers (no tool result exceeds 462 bytes); conversation compaction bounds unlimited real-chat growth this task set doesn't produce (longest conversation: 181 estimated tokens, far under the 4000-token threshold); prefix stability changes nothing about request *content*, only its byte-for-byte consistency call to call, so it has no token count to move; RTK's own ceiling here is ~0.03% of input (`execute_command` produced 15 tokens of output across the whole baseline). All five are kept anyway, as bounds on real-world inputs this benchmark doesn't represent, not as contributors to this figure.
- **Bounded file reads has a real, measured *cost* here**: adding `start_line`/`end_line` to `read_file`'s advertised schema costs roughly 71 estimated tokens on every call whose tool set includes it, with no offsetting benefit on this task set (no task needs a partial read).
- **The one substantial reduction — no longer advertising `spawn_subagent` and dropping argument descriptions that only restate the schema — measures −24.4% in isolation**, but diluted once averaged against the full call mix (e.g. a sub-agent's own tool set never advertised `spawn_subagent` in the first place, so that part of the saving doesn't apply there) and partly offset by an unexplained increase in *output* tokens on the sub-agent task (113→151 estimated tokens/execution, at fixed sampling) that this change does not have a confirmed cause for.
- **A candidate was tried and reverted after it regressed correctness**: trimming the agent's system instruction to stop repeating what the tool definitions already say (e.g. "inside the sandbox") reliably made `qwen2.5` return an empty response instead of the tool call a task needed — twice, in two different ways, on two different tasks. The instruction ships unchanged.
- **A composability caveat, not a fourth reduction**: the shipped "no longer advertising `spawn_subagent`" and "drop restating argument descriptions" changes are only safe together *because* bounded file reads is always present alongside them — isolated together without it, the same empty-response failure reappears on a different task (`word-count-skill`). These three are not independently toggleable on this model.

None of this was worked around by tightening a limit until 30% appeared; the real figure is reported as measured.

## Adding a new LLM connector

1. Create a new directory under `src/llms/<your-provider>/` with an `index.ts` exporting a class that extends `BaseConnector` and implements `callLlm(request: LlmRequest): Promise<LlmResult>`. If the provider supports tool calling, read `request.tools` and return requested calls as `result.toolCalls`; if not, ignore `request.tools` and always return text-only results (see `src/llms/stub/index.ts`).
2. Register it in `src/llm/connector-registry.ts`'s `CONNECTOR_FACTORIES` map, keyed by the name you'll use for `LLM_PROVIDER`. Startup validation (`config.ts`) automatically accepts this new name, since it's derived from the same map rather than a separate list.
3. Set `LLM_PROVIDER=<your-provider>` in `.env`.

No changes are needed anywhere else: the runner, caller, and orchestrator only ever depend on the `BaseConnector` contract.

## Adding a new tool

1. Create a new file under `src/tools/` exporting a `Tool` (`{ name, description, parameters, execute(context, args) }`). `parameters` is the JSON Schema advertised to the LLM; `execute` runs inside the sandbox via `context.execInContainer(command, stdin?)` and returns a `ToolResult` (`{ ok, output?, error? }`).
2. Register it in `createDefaultToolRegistry()` in `src/tools/index.ts`.

No orchestrator or sandbox changes are needed: the registry is the only thing that knows which tools exist.
