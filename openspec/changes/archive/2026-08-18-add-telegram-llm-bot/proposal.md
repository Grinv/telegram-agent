## Why

We need a minimal Telegram bot that forwards user messages to a local LLM (via Ollama) and returns the reply, built to teach the raw mechanics of the Telegram Bot API (no SDK) and to establish an extensible, process-isolated plugin architecture for LLM inference before Ollama itself is wired up.

## What Changes

- Add a Telegram Bot API gateway built on raw HTTPS requests (long polling via `getUpdates`, replies via `sendMessage`) — no third-party Telegram SDK, to avoid supply-chain risk and expose how the Bot API works.
- Add a pluggable LLM inference architecture: a `BaseConnector` contract exposing a single `callLlm(prompt)` method, with concrete connectors under `llms/<provider>/` (e.g. `llms/ollama`, `llms/stub`).
- Add a stub connector that returns a canned/echo response, since Ollama is not yet connected — it implements the same `BaseConnector` interface so swapping in the real Ollama connector later requires no orchestrator changes.
- Run each LLM inference call in an isolated child process with a timeout, so a hung or crashed connector cannot block or take down the bot process; the orchestrator kills the child and returns an error reply on timeout/failure.
- Add a stateless one-shot orchestration flow: `User Message → LLM → Bot Reply`, with no conversation history/memory persisted between messages.
- Add structured, timestamped, color-coded console logging, and top-level exception/error handling for connector-not-configured, connector-error, and connector-timeout/hang cases.
- Add automated tests (using Node's built-in test runner) covering the connector interface, the stub connector, the process-isolation/timeout behavior, and the orchestration flow.
- Configure `TELEGRAM_BOT_TOKEN` (and related config) via environment variables loaded from a git-ignored `.env` file — never hard-coded, never committed.
- Target the current Node.js LTS runtime and TypeScript.

## Capabilities

### New Capabilities
- `telegram-gateway`: Dependency-free Telegram Bot API client — long-polls for updates and sends replies over raw HTTPS.
- `llm-inference`: Plugin-based LLM connector architecture (`BaseConnector`, `callLlm(prompt)`), a stub connector, and out-of-process execution with a kill-on-timeout guarantee.
- `bot-orchestrator`: Wires an incoming Telegram message to an LLM connector call and back to a reply, one-shot with no persisted history, with error handling for inference failures.
- `logging`: Structured, colorized, timestamped console logging and centralized handling of uncaught exceptions and connector failure modes.

### Modified Capabilities
(none — this is a greenfield project)

## Impact

- New TypeScript Node.js project (package.json, tsconfig, source tree) — no existing code affected.
- New runtime dependency: none beyond Node.js built-ins and the TypeScript toolchain (dev-only). No Telegram SDK, no HTTP client library.
- New required environment variable: `TELEGRAM_BOT_TOKEN` (via `.env`, git-ignored).
- New child-process boundary between the bot orchestrator and LLM connectors (process spawn/kill on timeout).
- Ollama is not yet integrated end-to-end; the `llms/ollama` connector may be scaffolded but the active default connector is the stub until Ollama is available.
