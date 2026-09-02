## Why

The bot currently treats every incoming Telegram message as an independent, memoryless request: only the triggering message reaches the LLM, so the bot cannot refer back to anything said earlier in the same chat. Users want the bot to hold a real conversation, remembering prior turns (and who sent them) until they explicitly ask it to forget via a `/reset-context` command. `openspec/config.yaml` flags this exact tradeoff and requires "an explicit decision to change that" — this proposal is that decision.

## What Changes

- Persist a per-chat conversation history (user and assistant turns, in order) to a local SQLite database, surviving bot restarts.
- Tag each stored user turn with the sender's Telegram identity (user id and a display name/username), so multi-user group chats keep turns attributable to the right person.
- On every incoming message, load the chat's full persisted history, append the new user turn, send the whole history to the LLM (instead of just the latest message), and persist the assistant's final reply as the next turn.
- History is unbounded by default (no automatic trimming) — it only shrinks via explicit reset.
- Add a `/reset-context` command: when a chat sends exactly this text, the bot clears that chat's persisted history and replies with a confirmation, without invoking the LLM for that message.
- Capture the sender identity (`from.id`, display name) from incoming Telegram updates — today `TelegramMessage` only exposes `chat.id` and `text`, so the gateway does not actually expose sender identity to callers despite the existing spec scenario implying it does.
- **BREAKING**: `runLoop`/`createMessageHandler` behavior changes from strictly one-shot to history-aware; the "One-shot message handling" requirement in `bot-orchestrator` is replaced. Message-level statistics recording (`agent-stats`) is unaffected and continues to log every message regardless of `/reset-context` — the two are independent (chat history is conversational state for the LLM; stats are an append-only operational log).

## Capabilities

### New Capabilities
- `chat-context-history`: persistent per-chat conversation history — schema, storage (SQLite), append/read/clear operations, sender attribution per stored turn.

### Modified Capabilities
- `bot-orchestrator`: replaces the "One-shot message handling" requirement with history-aware handling (load history → append turn → send full history to LLM → persist reply), and adds a `/reset-context` command requirement.
- `telegram-gateway`: the incoming-message requirement is clarified/extended so `TelegramMessage` actually carries the sender's id and display name to callers, not just chat id and text.

## Impact

- `src/orchestrator.ts`: `createMessageHandler` gains a history store dependency, builds `messages` from persisted history instead of a single-item array, handles `/reset-context` as a special case, and persists the new turns after a successful reply.
- `src/telegram/client.ts`: `TelegramMessage` gains a `from` field (id + display name) parsed from the Telegram API response.
- New `src/history/` module: SQLite-backed store (following the `src/stats/` pattern: `node:sqlite`, versioned migrations, file under `data/`, gitignored) with `getHistory(chatId)`, `appendMessage(chatId, message)`, `clearHistory(chatId)`.
- `src/llm/types.ts`: `UserMessage` (or the history record type) carries sender attribution; no change to the connector wire contract (`ChatMessage[]` still flows through `LlmRequest.messages` unchanged) — sender identity is folded into `content` when building the LLM request.
- No change to `src/llms/*` connectors or `src/stats/*` — history persistence is a separate SQLite database/module from agent-stats, and stats recording is untouched by `/reset-context`.
