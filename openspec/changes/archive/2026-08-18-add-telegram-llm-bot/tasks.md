## 1. Project Setup

- [x] 1.1 Initialize `package.json` (ESM, `"type": "module"`), pin `engines.node` to the current LTS major version
- [x] 1.2 Add TypeScript config (`tsconfig.json`) and dev dependencies (`typescript`, `@types/node`, `tsx`)
- [x] 1.3 Add `.gitignore` covering `.env`, `node_modules`, and build output
- [x] 1.4 Add `.env.example` documenting `TELEGRAM_BOT_TOKEN`, `LLM_PROVIDER`, and any inference timeout setting (no real secrets)
- [x] 1.5 Add `npm` scripts: `dev` (via `tsx`), `build` (`tsc`), `start` (run compiled output), `test`

## 2. Logging

- [x] 2.1 Implement the logger module: ISO timestamp, level (`INFO`/`WARN`/`ERROR`), colorized output via `util.styleText`
- [x] 2.2 Register `process.on('uncaughtException', ...)` and `process.on('unhandledRejection', ...)` handlers that log via the logger
- [x] 2.3 Define labeled log helpers (or constants) for the three inference failure modes: not-configured, provider error, timeout

## 3. LLM Inference Plugin Architecture

- [x] 3.1 Define the `BaseConnector` abstract class and the `LlmResult` discriminated union type (`ok: true` / `ok: false` with `reason`)
- [x] 3.2 Implement `llms/stub/` connector returning a deterministic placeholder response
- [x] 3.3 Scaffold `llms/ollama/` connector implementing `BaseConnector` (not activated by default; calls a local Ollama HTTP endpoint)
- [x] 3.4 Implement connector selection (`LLM_PROVIDER` env var, default `stub`)
- [x] 3.5 Implement the inference-runner entrypoint script that a child process executes: loads the selected connector and calls `callLlm(prompt)`
- [x] 3.6 Implement the process-isolated inference caller: `child_process.fork` the runner, send the prompt over IPC, await response
- [x] 3.7 Implement timeout handling in the inference caller: start a timer, on expiry call `child.kill()` and resolve with a `TIMEOUT` failure
- [x] 3.8 Handle child crash/unexpected exit before a response arrives as a `PROVIDER_ERROR`/`TIMEOUT` failure (never an unhandled rejection)
- [x] 3.9 Log each failure mode (not-configured, provider error, timeout) with a distinguishable message via the logger

## 4. Telegram Gateway

- [x] 4.1 Implement config loading for `TELEGRAM_BOT_TOKEN` via `.env`/env vars, using Node's native env-file loading (no `dotenv` package)
- [x] 4.2 Fail fast at startup with a clear error if `TELEGRAM_BOT_TOKEN` is missing
- [x] 4.3 Implement `getUpdates` long polling against `https://api.telegram.org` using built-in `fetch`, tracking the `offset` to avoid re-processing updates
- [x] 4.4 Filter incoming updates to plain text messages; skip other update types without erroring
- [x] 4.5 Implement `sendMessage` to reply to the originating `chat_id` using built-in `fetch`
- [x] 4.6 Wrap the poll loop with basic delay-and-retry on transient network/HTTP errors so it doesn't crash the process

## 5. Bot Orchestrator

- [x] 5.1 Implement the one-shot handler: incoming text message → `callLlm(prompt)` via the process-isolated caller → reply, with no history/state kept between messages
- [x] 5.2 On successful inference, send the LLM's response back to the originating chat
- [x] 5.3 On inference failure (any reason), send a user-facing failure notice to the originating chat instead of leaving the user without a reply
- [x] 5.4 Wrap message handling in a try/catch so any unexpected error is logged and still results in a user-facing failure notice
- [x] 5.5 Wire up the application entrypoint: load config, start the logger's exception handlers, start the Telegram poll loop, dispatch each message to the orchestrator

## 6. Tests

- [x] 6.1 Set up `node:test` + `node:assert` as the test runner (no external test framework)
- [x] 6.2 Test the stub connector returns the expected placeholder `LlmResult` without any network call
- [x] 6.3 Test the process-isolated inference caller: success path, provider-error path, and timeout-kills-child path (using a fake/slow runner script)
- [x] 6.4 Test the bot orchestrator's one-shot flow with a fake connector: success reply, failure reply, and no state retained across two calls
- [x] 6.5 Test the Telegram gateway's update filtering (text message passes through, non-text update is skipped) using a fake `fetch`
- [x] 6.6 Test startup fails fast when `TELEGRAM_BOT_TOKEN` is missing

## 7. Documentation

- [x] 7.1 Write a `README.md` covering setup (`.env`, Node version), running (`npm run dev`/`start`), running tests, and how to add a new connector under `llms/`
