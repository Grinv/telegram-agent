## Context

See `proposal.md` - Why/What Changes for motivation. Relevant current state:

- `createMessageHandler` (`src/orchestrator.ts`) builds `messages: ChatMessage[]` from scratch per call (`[{ role: 'user', content: prompt }]`) and calls `runLoop`. `runLoop` mutates that array in place (pushing `assistant`/`tool` messages) but the array is discarded once the handler returns — nothing persists across messages.
- `ChatMessage` (`src/llm/types.ts`) is a `UserMessage | AssistantMessage | ToolMessage` union; the connector wire contract (`LlmRequest.messages`) already accepts an arbitrary ordered list, so no connector change is needed to send more history — only the orchestrator needs to build a longer list.
- `TelegramMessage` (`src/telegram/client.ts`) currently only parses `message_id`, `chat.id`, `text` from the Telegram API response; it drops the `from` field entirely.
- `src/stats/` is the existing precedent for a local SQLite-backed module: `node:sqlite`, a `schema.sql` + versioned `migrations.ts` (`PRAGMA user_version`), a db file under `data/` (gitignored), and a thin recorder class. `chat-context-history` follows the same shape as a sibling, independent module (separate db file, e.g. `data/history.db`).

## Goals / Non-Goals

**Goals:**
- Give the LLM the full prior conversation for a chat on every message, persisted across restarts.
- Attribute each stored user turn to its Telegram sender (id + display name).
- Provide `/new` to clear one chat's history on demand.
- Keep `chat-context-history` fully decoupled from `agent-stats` (separate db, separate module, no shared code path beyond both being optional-ish orchestrator dependencies).

**Non-Goals:**
- No automatic trimming/summarization of history (explicit user decision: unbounded until reset).
- No cross-chat memory or global user profile — history is scoped strictly per chat ID, matching how Telegram chats already isolate group vs. DM state.
- No change to the LLM connector wire contract (`ChatMessage`, `LlmRequest`) — history is assembled into the existing shape.
- No editing/deleting individual turns — only whole-chat clear via `/new`.

## Decisions

**Storage: new `src/history/` module, SQLite, separate db file from stats.**
Mirrors `src/stats/` (`schema.sql`, `migrations.ts` with `PRAGMA user_version`, `node:sqlite`). A separate file (`data/history.db`, path from a new `HISTORY_DB_PATH`/`config.historyDbPath`) rather than a table in `stats.db` keeps the two concerns physically independent, so a bug or lock contention in one can't affect the other, and matches the proposal's explicit requirement that clearing history never touches stats. Alternative considered: one shared db with two tables — rejected because it couples two independently-evolving concerns (stats is an append-only log with its own migration cadence; history supports deletes) for no real benefit.

**Schema:** one table, e.g. `turns(id INTEGER PRIMARY KEY, chat_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, sender_id INTEGER, sender_name TEXT, created_at INTEGER NOT NULL)`, indexed on `chat_id`. `role` is `user` or `assistant` (tool/observation messages from mid-loop are never persisted, per the `bot-orchestrator` delta spec). `sender_id`/`sender_name` are populated for `user` rows and `NULL` for `assistant` rows.

**Sender attribution folded into `content`, not a new `ChatMessage` field.**
When the orchestrator loads history and builds the `ChatMessage[]` to send to the LLM, each stored user turn is rendered as `UserMessage` with `content` prefixed by the sender's display name (e.g. `"Alice: <message text>"`) rather than adding a `senderId`/`senderName` field to the `UserMessage` type. This keeps the LLM connector contract (`llm-inference` spec) completely unchanged — the LLM sees plain chat-style text, which every provider already knows how to consume — while the *storage* layer (`src/history/`) still records structured `sender_id`/`sender_name` per row for anything that needs it later (e.g. future per-user features). Alternative considered: extend `UserMessage` with sender fields and have connectors format them — rejected as unnecessary connector-contract churn for a single-consumer formatting concern.

**`/new` handled in the orchestrator, before routing/LLM.**
`createMessageHandler` checks `message.text === '/new'` first (same place it currently extracts `prompt`), calls the history store's clear operation, sends a confirmation reply, and returns — skipping `router.route`, `runLoop`, and all stats/LLM hooks for that message. Alternative considered: recognize the command in `telegram-gateway`/poller — rejected because the poller's job is transport (turning updates into `TelegramMessage`s), not command semantics; keeping command interpretation in the orchestrator matches where all other message-handling logic already lives.

**Telegram `from` field: parsed in `src/telegram/client.ts`, typed as `{ id: number; name: string }` on `TelegramMessage`.**
`name` resolves to `username` if present, else `first_name` (Telegram guarantees `first_name` on every `from`). This is a pure parsing addition to the existing `TelegramMessage`/`TelegramUpdate` interfaces and `getUpdates` mapping — no new API calls.

**History load/append is synchronous with the request path (not fire-and-forget like stats).**
Unlike `StatsRecorder` (explicitly fire-and-forget, optional, failure-tolerant per its spec), history must be read *before* building the LLM request and its writes must complete reliably enough that the next message sees them — it's part of the core behavior, not a side observation. `node:sqlite` is synchronous, so this is a plain in-process call, not a new async-failure surface. Both directions still fail the message like today's `catch` clause (see `bot-orchestrator`'s "No message is silently dropped" requirement, unchanged).

## Risks / Trade-offs

- **[Risk]** Unbounded history (per explicit user decision) can eventually make the prompt sent to the LLM very large for long-running chats, degrading latency/quality or exceeding the provider's context window. → **Mitigation**: none in this change (explicitly out of scope by decision); `/new` is the user's escape hatch. A future change can add trimming if this becomes a real problem.
- **[Risk]** `node:sqlite` opens the db file with a lock; if `history.db` and `stats.db` ever needed a single transaction spanning both, that's not supported by this design. → **Mitigation**: not needed — the two are explicitly required to be independent (see proposal Impact).
- **[Risk]** Storing raw message text (including group-chat content from third parties) in a new persistent file is a bigger confidentiality surface than the existing memoryless design. → **Mitigation**: `data/` is already gitignored (same as `stats.db`); no new exposure beyond what `agent-stats` already accepts for prompts when `statsStorePrompts` is enabled.

## Migration Plan

- New `history` capability ships alongside existing code; no data migration needed (fresh db file, created on first write via `migrate()` at schema v1, same pattern as `src/stats/migrations.ts`).
- Rollout is a normal deploy: no flag needed since `/new` is opt-in per chat and the "one-shot" behavior for a chat's very first message is unchanged (empty history). If needed, an operator can delete `data/history.db` to fully reset (equivalent to every chat running `/new`).
