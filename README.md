# telegram-llm-bot

A minimal Telegram bot that forwards each message to a pluggable LLM connector and replies with the result. No Telegram SDK — the Bot API is called directly over HTTPS with Node's built-in `fetch`. Every message is handled independently; no conversation history is kept.

## Requirements

- Node.js 24.x (current LTS)

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
   | `TELEGRAM_BOT_TOKEN` | yes | — | Bot token from @BotFather. Startup fails fast if missing. |
   | `LLM_PROVIDER` | no | `ollama` | Which connector under `src/llms/` to use (`stub` or `ollama`). Startup fails fast if set to anything else. |
   | `LLM_TIMEOUT_MS` | no | `15000` | Max time to wait for an inference call before killing it and reporting a timeout. |
   | `OLLAMA_BASE_URL` | no | `http://127.0.0.1:11434` | Only used by the `ollama` connector. |
   | `OLLAMA_MODEL` | no | `llama3` | Only used by the `ollama` connector. |

   The default connector is `ollama`, so **Ollama must be running locally** (`ollama serve`) with the configured model already pulled (`ollama pull llama3`, or whatever `OLLAMA_MODEL` you set), or every message will fail with a provider-error reply. Set `LLM_PROVIDER=stub` instead if you just want a placeholder reply with no LLM running.

## Running

```bash
npm run dev      # run from TypeScript source via tsx, for local development
npm run build    # compile to dist/
npm start        # run the compiled build (dist/index.js)
```

## Testing

```bash
npm test
```

Uses Node's built-in test runner (`node:test`) and `node:assert` — no test framework dependency. Telegram HTTP calls and the child-process inference boundary are exercised with fakes/fixtures, so tests don't hit the real Telegram API or spawn a real Ollama instance.

## Architecture

- `src/telegram/` — dependency-free Telegram Bot API client (`client.ts`, raw `fetch` calls) and the long-polling loop (`poller.ts`).
- `src/llm/` — the connector plugin contract:
  - `base-connector.ts` — abstract `BaseConnector` class with one method, `callLlm(prompt): Promise<LlmResult>`.
  - `connector-registry.ts` — resolves a provider name (`LLM_PROVIDER`) to a connector instance.
  - `inference-runner.ts` — entrypoint executed inside a forked child process; loads a connector and calls it.
  - `inference-caller.ts` — forks `inference-runner`, sends the prompt over IPC, and enforces a timeout that kills the child if it hangs.
- `src/llms/<provider>/` — one directory per connector implementation (`stub`, `ollama`).
- `src/orchestrator.ts` — wires an incoming message to `callLlmIsolated` and back to a reply; stateless, one message in, one reply out.
- `src/logger.ts` / `src/error-handlers.ts` — colorized console logging and top-level exception/rejection capture.

Each inference call runs in its own child process (see `inference-caller.ts`) so a connector that hangs, crashes, or throws can never block or take down the bot process — the parent kills the child on timeout and reports a typed failure instead.

The orchestrator logs the text of each incoming message and, on success, the LLM's reply text, so `npm run dev` shows the actual conversation as it happens:

```
[INFO] Message received { chatId: 123, prompt: 'hi' }
[INFO] Inference succeeded, sending reply { chatId: 123, reply: '...' }
```

This is console-only (nothing is persisted to a file or sent anywhere) - be mindful of what's visible in your terminal if a chat contains sensitive text.

## Adding a new LLM connector

1. Create a new directory under `src/llms/<your-provider>/` with an `index.ts` exporting a class that extends `BaseConnector` and implements `callLlm(prompt: string): Promise<LlmResult>`.
2. Register it in `src/llm/connector-registry.ts`'s `CONNECTOR_FACTORIES` map, keyed by the name you'll use for `LLM_PROVIDER`. Startup validation (`config.ts`) automatically accepts this new name - it's derived from the same map, not a separate list.
3. Set `LLM_PROVIDER=<your-provider>` in `.env`.

No changes are needed anywhere else — the runner, caller, and orchestrator only ever depend on the `BaseConnector` contract.
