## 1. Connector Registry & Config

- [x] 1.1 Export the set of known provider names from `src/llm/connector-registry.ts` (derived from the existing factory map, not duplicated)
- [x] 1.2 In `src/config.ts`, validate `LLM_PROVIDER` against that set at load time; throw `ConfigError` with a clear message (listing valid values) when it doesn't match
- [x] 1.3 Change `config.ts`'s default `llmProvider` fallback from `'stub'` to `'ollama'`

## 2. OllamaConnector Testability

- [x] 2.1 Add an injectable `fetchImpl: typeof fetch = fetch` constructor parameter to `OllamaConnector`, mirroring `TelegramClient`'s existing pattern
- [x] 2.2 Use `this.fetchImpl` instead of the global `fetch` inside `callLlm`

## 3. Tests

- [x] 3.1 Unit test `OllamaConnector` success path with a fake `fetchImpl` returning a valid `{ response: "..." }` body
- [x] 3.2 Unit test `OllamaConnector` non-OK HTTP response (e.g. 404) resolves with `PROVIDER_ERROR`
- [x] 3.3 Unit test `OllamaConnector` malformed response body (missing `response` field) resolves with `PROVIDER_ERROR`
- [x] 3.4 Unit test `OllamaConnector` network/fetch exception resolves with `PROVIDER_ERROR` instead of throwing
- [x] 3.5 Unit test `connector-registry.createConnector` resolves an instance for each known provider name (`stub`, `ollama`)
- [x] 3.6 Unit test `connector-registry.createConnector` throws `ConnectorNotConfiguredError` for an unrecognized name
- [x] 3.7 Unit test `config`'s provider validation throws `ConfigError` for an unrecognized `LLM_PROVIDER` value (tested via the extracted pure `resolveLlmProvider` helper, added during implementation so this logic is hermetically testable regardless of the real local `.env` - see note below)
- [x] 3.8 Unit test `config`'s provider default resolves to `'ollama'` when `LLM_PROVIDER` is unset (same `resolveLlmProvider` helper)

## 4. Documentation

- [x] 4.1 Update `.env.example` and `README.md` to reflect the new default provider and note that Ollama must be running locally for it to work out of the box

## 5. Manual End-to-End Verification

- [x] 5.1 Correct the local `.env` for this machine: `LLM_PROVIDER=ollama`, `OLLAMA_MODEL=tinyllama` (a small, already-pulled model, fast to verify with)
- [x] 5.2 Run the bot locally (`npm run dev`) against the real, running local Ollama instance and the real Telegram bot token
- [x] 5.3 Send a real message to the bot in Telegram and confirm a real Ollama-generated reply is received; record the outcome (not an automated test - a one-time manual check) - **Verified 2026-08-18**: bot started with `llmProvider: 'ollama'`, a real message to `@grinv_bot` was processed end-to-end (`Inference succeeded, sending reply { chatId: 3958254 }`), no errors logged.
