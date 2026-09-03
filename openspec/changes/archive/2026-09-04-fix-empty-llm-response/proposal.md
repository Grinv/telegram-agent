## Why

`runLoop` (`src/orchestrator.ts`) treats any `result.ok === true` from the LLM connector as a final answer once `result.toolCalls` is empty, and returns it as the loop's success text. In production, a small local model (`qwen3:1.7b` via the `ollama` connector, tools enabled) sometimes returns `{ ok: true, text: '', toolCalls: undefined }` — a syntactically valid response with no answer and no tool call, distinct from a connector-level failure (`NOT_CONFIGURED`/`PROVIDER_ERROR`/`TIMEOUT`). `runLoop` returns this empty string as `{ ok: true, text: '' }`, and `createMessageHandler` then calls `client.sendMessage(chatId, '')`. The Telegram Bot API rejects an empty `text` with HTTP 400, so delivery throws, and the message ends up reported as `DELIVERY_FAILED` in stats and answered with the generic failure notice — the same outcome a real failure would produce, but reached by accident through a downstream HTTP rejection rather than by the loop recognizing the response as unusable.

Confirmed live: `docker exec telegram-agent-bot-1` reproduction of the exact production request (system instruction + tool definitions + `qwen3:1.7b`) for the prompts "Какой сегодня день?" and "Кто ты?" returned `{ ok: true, text: '', toolCalls: undefined }` from the `ollama` connector on some runs (non-deterministic — the same prompt in isolation, without prior chat history in the request, produced a valid `toolCalls` entry instead). Bot logs for chat `3958254` show `Inference succeeded, sending reply { reply: '', iterations: 1 }` immediately followed by `Unexpected error while handling message { error: 'sendMessage failed with HTTP 400' }` for both prompts.

## What Changes

- `runLoop` treats a `result.ok === true` response with no tool calls and empty (or whitespace-only) `text` as a loop failure, not a success — returned as `{ ok: false, reason: 'EMPTY_RESPONSE', iterations: i + 1 }`, mirroring the existing `MAX_ITERATIONS` shape (a `LoopResult` failure reason that is not one of the connector-level `LlmFailureReason` values).
- This failure reaches `createMessageHandler` through the existing `!result.ok` path: the generic failure notice (`FAILURE_REPLY_TEXT`) is sent instead of an attempted empty `sendMessage`, `statsRecorder.recordMessage` receives `ok: false, reason: 'EMPTY_RESPONSE'` directly (instead of `DELIVERY_FAILED`, which remains reserved for genuine delivery failures), and — per the already-implemented `chat-context-history` behavior — only the user's turn is persisted to history, no assistant turn.
- A log entry is emitted when this case is hit (loop iteration, model), so it is distinguishable in operational logs from both a genuine delivery failure and `MAX_ITERATIONS`.

## Capabilities

### Modified Capabilities
- `bot-orchestrator`: the "Reply reflects inference outcome" requirement gains a scenario for an empty final answer with no tool calls, and "No message is silently dropped" / the loop's failure handling now covers this case explicitly.

## Impact

- `src/orchestrator.ts`: `runLoop` — add the empty-response check after the existing `!result.toolCalls || result.toolCalls.length === 0` early-return-on-success branch, before it returns success.
- No change to `src/llm/types.ts` (`LlmFailureReason` stays connector-level failures only), `src/llm/failure-labels.ts`, `src/history/*`, or `src/telegram/client.ts` — this is scoped entirely to `runLoop`'s success/failure classification.
- `statsRecorder.recordMessage`'s `reason` field, already a plain `string` (`src/stats/types.ts`), accepts `'EMPTY_RESPONSE'` with no type change needed.
