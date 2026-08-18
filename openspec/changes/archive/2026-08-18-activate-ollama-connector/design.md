## Context

See proposal.md - Why. Today, connector selection happens entirely inside the forked inference child (`src/llm/inference-runner.ts` calls `createConnector(provider)` from `src/llm/connector-registry.ts`), which is why an invalid `LLM_PROVIDER` currently only surfaces as a per-message `NOT_CONFIGURED` failure rather than a startup error - the main process never looks at the provider name before spawning a child per message. `OllamaConnector` (`src/llms/ollama/index.ts`) calls the global `fetch` directly, unlike `TelegramClient`, which already accepts an injectable `fetchImpl` for testability.

## Goals / Non-Goals

**Goals:**
- Move provider-name validation into the main process at startup, so a bad value fails once, loudly, instead of per message.
- Flip the default connector to `ollama` without duplicating the list of valid provider names between `config.ts` and `connector-registry.ts`.
- Bring `OllamaConnector` up to the same testability standard as `TelegramClient`.

**Non-Goals:**
- Validating that the configured Ollama *model* exists or that Ollama is actually reachable at startup - that's a runtime condition (Ollama can go down mid-session, models can be pulled/removed), already correctly handled per-message as a `PROVIDER_ERROR` (verified manually against a real Ollama instance: a missing model returns `404 {"error":"model '' not found"}`, which the connector already turns into a typed failure).
- Changing anything about `telegram-gateway`, `bot-orchestrator`, or `logging` - none of their behavior changes here.
- Adding retry/fallback logic if Ollama is down (still out of scope, per the original change's Non-Goals).

## Decisions

### 1. Single source of truth for valid provider names
Export the set of registered provider names from `connector-registry.ts` (e.g. a `KNOWN_PROVIDERS` array/set built from the same object that already maps name -> factory) and import it into `config.ts` for the startup check. `connector-registry.ts` still throws `ConnectorNotConfiguredError` for the runtime/child-process path (defense in depth is harmless here since it's the same cheap check), but `config.ts` is what actually stops startup.
- Alternative considered: duplicate a hardcoded list of provider names in `config.ts` - rejected as a DRY violation; the two lists would silently drift the next time a connector is added.

### 2. Where the fail-fast check lives
`loadConfig()` in `src/config.ts` validates `LLM_PROVIDER` right after reading it, throwing the existing `ConfigError` (same type already used for a missing `TELEGRAM_BOT_TOKEN`) - `index.ts` already catches `ConfigError` and exits cleanly with a logged message, so no new error-handling path is needed.

### 3. Default value change
`config.ts`'s fallback for `llmProvider` changes from `'stub'` to `'ollama'` (one-line change). No new config surface - `OLLAMA_BASE_URL`/`OLLAMA_MODEL` already exist and already default sensibly (`http://127.0.0.1:11434`, `llama3`) per the original change.

### 4. OllamaConnector testability
Add a constructor-injected `fetchImpl: typeof fetch = fetch` parameter to `OllamaConnector`, mirroring `TelegramClient`'s existing constructor shape exactly. Tests inject a fake `fetchImpl` and never touch the network, consistent with how `TelegramClient` is already tested.
- Alternative considered: mock the global `fetch` per-test (e.g. reassigning `globalThis.fetch`) - rejected; it's global mutable state shared across parallel test files, whereas constructor injection is already the established pattern in this codebase (KISS: reuse what's there).

### 5. Verification approach
Automated tests stay hermetic (fakes only, per project convention - no test depends on a running Ollama). The actual live check - real Telegram token, real running Ollama, real `tinyllama` model - is a one-time manual verification step during `apply`, not part of `npm test`. `.env`'s current values will need correcting for that step (`LLM_PROVIDER=ollama`, `OLLAMA_MODEL=tinyllama` - `tinyllama` is a small, fast local model, good for a quick manual check).

### 6. Provider/token validation extracted as pure functions (found during implementation)
While writing the tests for task 3.7/3.8, `loadConfig()`'s tests turned out to be unreliable against a real local `.env`: `process.loadEnvFile()` silently refills any `process.env` var a test `delete`s, from whatever is actually on disk - so a test that deletes `LLM_PROVIDER` (or `TELEGRAM_BOT_TOKEN`) to test the "missing" case doesn't observe an absence at all once a real `.env` exists, as it now does on this machine. `resolveLlmProvider(raw)` and `resolveTelegramBotToken(raw)` were extracted as pure functions (no env/filesystem access) so this logic can be unit-tested hermetically; `loadConfig()` now just wires them to `process.env`. No observable behavior changed - same errors, same messages, same default - only where the logic lives. This also fixed a latent bug in the pre-existing `TELEGRAM_BOT_TOKEN`-missing test, which was passing for the wrong reason (any `ConfigError` satisfied its assertion, regardless of cause).

## Risks / Trade-offs

- [Flipping the default to `ollama` means a fresh checkout with no Ollama running now gets per-message `PROVIDER_ERROR` replies instead of the stub's placeholder] → Accepted per explicit user decision; `.env.example` and README are updated to say Ollama must be running locally, and `LLM_PROVIDER=stub` remains available to restore the old behavior.
- [The startup check only validates the provider *name*, not that Ollama is actually reachable] → Intentional (see Non-Goals) - reachability is a runtime concern already handled by the existing `PROVIDER_ERROR` path.
