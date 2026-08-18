## Why

A real Telegram bot token is now configured and Ollama is running locally with real models pulled (`tinyllama`, `codellama`). While checking this over, we found `.env` had `LLM_PROVIDER=tinyllama` — an invalid value (a model name, not a provider name) that the system currently accepts silently: every message would fail with an unhelpful `NOT_CONFIGURED` reply instead of the bot refusing to start. Now that Ollama is verified reachable, it's time to make it the default connector, close that validation gap, and add the test coverage the Ollama connector never got.

## What Changes

- Change the default `LLM_PROVIDER` from `stub` to `ollama`, now that a live Ollama instance is the expected local setup.
- Add fail-fast startup validation: reject an unrecognized `LLM_PROVIDER` value immediately (mirroring the existing `TELEGRAM_BOT_TOKEN` check) instead of only surfacing it as a per-message `NOT_CONFIGURED` failure.
- Make `OllamaConnector`'s HTTP calls injectable (same pattern already used by `TelegramClient`) so it can be unit-tested without a live Ollama instance.
- Add unit tests for `OllamaConnector` (success, non-OK HTTP response, malformed response body, network failure) and for connector selection (known vs. unknown provider names) - this connector currently has zero test coverage.
- Manually verify the full path end-to-end: real Telegram message -> real Ollama inference -> real Telegram reply.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `llm-inference`: adds the default-connector-is-ollama behavior and the fail-fast provider validation requirement.

## Impact

- `src/config.ts`: default `llmProvider` changes from `'stub'` to `'ollama'`; startup now throws `ConfigError` for an unrecognized `LLM_PROVIDER` value.
- `src/llm/connector-registry.ts`: exposes the set of known provider names so config validation and the registry share one source of truth (no duplicated list).
- `src/llms/ollama/index.ts`: gains an injectable fetch implementation for testability; no behavior change for production use.
- `.env.example` / `README.md`: updated to reflect the new default and note that Ollama must be running locally for it to work out of the box.
- No changes to `telegram-gateway`, `bot-orchestrator`, or `logging` behavior.
- **BREAKING** for anyone relying on the implicit old default: a fresh checkout with no `LLM_PROVIDER` set and no local Ollama running will now get per-message `PROVIDER_ERROR` replies instead of the stub's placeholder response. Explicitly setting `LLM_PROVIDER=stub` restores the old behavior.
