## Context

Greenfield project (see proposal.md - Why). Constraints carried over from the assignment: TypeScript on Node.js, current LTS; no third-party Telegram SDK; LLM inference must be pluggable behind one `callLlm(prompt)` contract; inference must run out-of-process so a hang/crash can be killed without affecting the bot; Ollama is not available yet, so a stub connector is the active default; secrets only via `.env`/environment variables.

## Goals / Non-Goals

**Goals:**
- Dependency-free Telegram integration using Node's built-in `fetch`/`https` (no Telegram SDK).
- A `BaseConnector` plugin contract (`callLlm(prompt)`) under which `llms/stub` and a scaffolded `llms/ollama` both live, selected by config.
- Out-of-process inference execution with a hard timeout and guaranteed kill of the child on hang, crash, or timeout.
- Structured, colorized, timestamped console logging and centralized handling of uncaught exceptions and every inference failure mode.
- One-shot `User Message → LLM → Bot Reply` flow with zero persisted history.
- Automated tests using Node's built-in test runner, no test-framework dependency.

**Non-Goals:**
- Real Ollama wiring end-to-end (connector is scaffolded, not activated/validated against a live Ollama instance).
- Conversation memory, multi-turn context, or persistence of any kind.
- Telegram webhook mode, horizontal scaling, multi-instance coordination, or rate limiting/auth beyond the bot token itself.
- Retry/backoff policies beyond the single timeout-and-fail behavior for inference.

## Decisions

### 1. Runtime & module system: TypeScript on current Node.js LTS, native ESM
Use the current Active LTS Node.js release, TypeScript compiled with `tsc`, native ESM modules, `tsx` for local dev execution. TypeScript/`tsx`/`@types/node` are dev-only dependencies — the "no third-party libraries" constraint from the proposal applies to the Telegram Bot API integration, not the language toolchain.
- Alternative considered: CommonJS — rejected, ESM is the current Node default/best-practice and pairs cleanly with `node:test` and top-level await.

### 2. Telegram transport: native `fetch` + long polling, no SDK
Implement the gateway with Node's built-in global `fetch` calling `getUpdates` (long polling) and `sendMessage` directly against `https://api.telegram.org`. No `node-telegram-bot-api`/`telegraf`/etc.
- Alternative considered: raw `node:https` sockets — rejected as unnecessary ceremony; `fetch` is still a "pure HTTP request" with zero added dependencies and satisfies the transparency goal (understanding the Bot API directly).
- Alternative considered: webhook mode — rejected (non-goal): requires a public HTTPS endpoint, unnecessary for a local/simple bot.

### 3. Plugin architecture: `BaseConnector` abstract class + directory-per-provider
Define one `BaseConnector` abstract class with a single method `callLlm(prompt: string): Promise<LlmResult>`. Each provider lives in its own directory (`llms/stub/`, `llms/ollama/`) exporting a class extending `BaseConnector`. An active connector is chosen at startup by a config value (e.g. `LLM_PROVIDER`), defaulting to `stub` since Ollama isn't connected yet.
- Alternative considered: a plain function-map registry instead of a base class — rejected; an abstract class gives a single enforced shape (`callLlm`) and a natural extension point (shared timeout/error-wrapping logic could live in the base class later), matching the assignment's explicit ask for a `BaseConnector`.
- `LlmResult` is a discriminated union (`{ ok: true, text }` | `{ ok: false, reason: 'NOT_CONFIGURED' | 'PROVIDER_ERROR' | 'TIMEOUT' }`) so failure modes are typed, not thrown as opaque exceptions, satisfying the orchestrator's and logger's need to distinguish them.

### 4. Process isolation: `child_process.fork` per inference call, with timeout-based `kill()`
Each `callLlm` invocation runs inside a short-lived child process (via `child_process.fork` running a small inference-runner entrypoint), communicating over IPC. The parent starts a timer alongside the IPC request; if the child hasn't responded when the timer fires, the parent calls `child.kill()` and resolves with a `TIMEOUT` failure. Any child crash/exit-before-response is likewise turned into a `PROVIDER_ERROR`/`TIMEOUT` failure rather than propagating an unhandled rejection.
- Alternative considered: `worker_threads` — rejected; workers share the process's memory/event loop and a truly hung synchronous or native call is harder to guarantee-terminate than a full OS process kill, and a worker crash can be noisier to isolate than a separate process exiting.
- Alternative considered: run inference in-process with only a `Promise.race` timeout — rejected; a `Promise.race` can abandon a hung promise logically but cannot stop the underlying work or reclaim it, which fails the explicit "kill it" requirement.
- Trade-off accepted: spawning a process per message has measurable overhead; acceptable for this assignment's scope (see Risks).

### 5. Config loading: Node's built-in env-file support, no `dotenv` package
Use Node's native `.env` loading (`process.loadEnvFile()` / `--env-file`, available in current LTS) instead of adding the `dotenv` package. Keeps the "avoid unnecessary third-party dependencies" spirit consistent across the whole project, not just the Telegram layer.

### 6. Logging: small internal logger built on `util.styleText`
Implement a minimal logger module using Node's built-in `util.styleText` for ANSI coloring (no `chalk`/`pino`). Each entry: ISO timestamp, level (`INFO`/`WARN`/`ERROR`), message, optional structured detail. A single `process.on('uncaughtException', ...)` / `process.on('unhandledRejection', ...)` pair routes to this logger at `ERROR` level. Each inference failure reason (`NOT_CONFIGURED`, `PROVIDER_ERROR`, `TIMEOUT`) is logged with its own distinguishable label.

### 7. Testing: `node:test` + `node:assert`, no test framework dependency
Use Node's built-in test runner. Telegram HTTP calls and the child-process boundary are covered with fakes/stubs (e.g. injecting a fake fetch and a fake connector module) rather than hitting real Telegram or spawning real Ollama, so tests are fast and hermetic.

## Risks / Trade-offs

- [Per-message process spawn adds latency (tens of ms) and OS overhead] → Acceptable at assignment scale (single bot, low traffic); a future iteration could pool workers if throughput becomes a concern (explicitly out of scope now, YAGNI).
- [`fetch`-based long polling holds an open connection per poll cycle; transient network errors need backoff] → Wrap the poll loop with a simple delay-and-retry on request failure so a transient network blip doesn't crash the process.
- [Killing a child process on timeout can't guarantee the underlying LLM call inside it (e.g. an in-flight HTTP request to Ollama) is cancelled on the provider's side] → Acceptable; the goal is protecting the bot process, not guaranteeing upstream cancellation.
- [No conversation memory means the bot cannot answer follow-up questions relying on prior context] → By design per proposal (one-shot); documented as a known limitation, not a defect.
