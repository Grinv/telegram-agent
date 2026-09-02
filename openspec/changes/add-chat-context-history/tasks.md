Sequencing note: this change depends on two others and should land after both. `add-agent-skills` introduces the system instruction that task 3.6 asserts is kept out of history — without it, that task has nothing to check. `fix-telegram-message-limit` makes a reply's delivery distinguishable from its production, which is what task 3.4 keys on; landing this change first would bake in the assumption that a produced reply was delivered.

## 1. History storage module (`src/history/`)

- [ ] 1.1 Add `src/history/schema.sql` defining the `turns` table (`id INTEGER PRIMARY KEY`, `chat_id INTEGER NOT NULL`, `role TEXT NOT NULL`, `content TEXT NOT NULL`, `sender_id INTEGER`, `sender_name TEXT`, `created_at INTEGER NOT NULL`) with an index on `chat_id`, and `src/history/migrations.ts` (mirroring `src/stats/migrations.ts`: `Migration[]`, `migrate(db, migrations?)` using `PRAGMA user_version`). Verify with a unit test that a fresh `DatabaseSync` ends at the latest `user_version` with the `turns` table present.
- [ ] 1.2 Add `src/history/types.ts` with `HistoryTurn` (`role: 'user' | 'assistant'`, `content: string`, `senderId?: number`, `senderName?: string`, `createdAt: number`) and a `HistoryStore` interface: `getHistory(chatId: number): HistoryTurn[]`, `appendTurn(chatId: number, turn: Omit<HistoryTurn, 'createdAt'>): void`, `clearHistory(chatId: number): void`.
- [ ] 1.3 Add `src/history/sqlite-store.ts` implementing `HistoryStore` with `node:sqlite`'s `DatabaseSync`, opening the db at a configurable path, running `migrate()` on construction, and implementing the three methods with prepared statements ordered by `id`/`created_at`. Verify with unit tests: append then get returns turns in order; turns from different `chat_id`s don't leak into each other's `getHistory`; `clearHistory` empties one chat without affecting another; `clearHistory` on an empty chat doesn't throw.
- [ ] 1.4 Add `src/history/index.ts` exporting `createHistoryStore(dbPath: string): HistoryStore` (mirrors `src/stats/index.ts`'s `createStatsRecorder`). Verify it constructs a `SqliteHistoryStore` and the module compiles under `tsc`.

## 2. Telegram sender identity

- [ ] 2.1 Extend `TelegramMessage`/`TelegramUpdate` in `src/telegram/client.ts` to parse Telegram's `from` object (`from.id`, `from.username`, `from.first_name`) into `message.from: { id: number; name: string }`, where `name` is `username` if present else `first_name`. Verify with a unit test (fake fetch response) that `getUpdates` returns a message with `from.id`/`from.name` populated from a fixture Telegram API payload.
- [ ] 2.2 Verify with a unit test that a Telegram update payload missing `from` (if any such update type reaches `extractTextMessage`) doesn't crash parsing (per existing "Non-text updates are ignored gracefully" behavior).

## 3. Orchestrator integration

- [ ] 3.1 Add a `historyStore: HistoryStore` dependency to `OrchestratorDeps` in `src/orchestrator.ts`.
- [ ] 3.2 In `handleMessage`, before building `messages`, add a `/new` branch: if `message.text === '/new'`, call `historyStore.clearHistory(chatId)`, send a confirmation reply via `deps.client.sendMessage`, log it, and return without calling the router, `runLoop`, or any stats hooks. Verify with a unit test using a fake `historyStore`/`client` that history is cleared, a confirmation is sent, and neither `callLlm` nor `statsRecorder` methods are invoked.
- [ ] 3.3 For normal messages, load `historyStore.getHistory(chatId)`, render each stored turn into a `ChatMessage` (`user` turns as `{ role: 'user', content: `${senderName}: ${content}` }`, `assistant` turns as `{ role: 'assistant', content }`), append the new incoming turn, and pass that full array as `messages` into `runLoop` (replacing the current single-item array). Verify with a unit test that a second message in the same chat produces an LLM request whose `messages` includes the first exchange.
- [ ] 3.4 Persist turns after the reply has been **delivered**, not merely produced: call `historyStore.appendTurn` for the user's turn (with `senderId`/`senderName` from `message.from`) and for the assistant's final reply once `client.sendMessage` has resolved; on a failed `runLoop` result, or when delivery throws, append only the user's turn. Verify with unit tests for all three branches (delivered success appends 2 turns; loop failure appends 1; delivery failure appends 1 — the last covers the spec scenario "Undelivered reply is not persisted").
- [ ] 3.5 Verify with a unit test that intermediate tool-call/observation messages added to the in-loop `messages` array by `runLoop` are not passed to `historyStore.appendTurn` (only the final user turn + final assistant text are persisted).

- [ ] 3.6 Ensure the agent's generated system instruction is prepended to the request but never passed to `historyStore.appendTurn`, and that it is reassembled per request rather than read back from storage. Verify with a unit test that after two messages in one chat, the stored turns contain no system instruction and the second request still carries one (covers "Generated instructions are not stored as history").

## 4. Config and wiring

- [ ] 4.1 Add `resolveHistoryDbPath(raw: string | undefined): string` to `src/config.ts` (default `'data/history.db'`, `HISTORY_DB_PATH` env var), add `historyDbPath: string` to `AppConfig`, and wire it into `loadConfig()`. Verify with a unit test covering the default and an explicit override.
- [ ] 4.2 In `src/index.ts`, construct `createHistoryStore(config.historyDbPath)` and pass it as `historyStore` into `createMessageHandler`. Verify by starting the bot locally (`npm run dev` or equivalent) and confirming `data/history.db` is created on first message.

## 5. End-to-end verification

- [ ] 5.1 Add/extend an orchestrator integration test (fake Telegram client, fake `callLlm`, real `SqliteHistoryStore` against a temp db file) covering: two consecutive messages in the same chat see prior history; `/new` clears it; a third chat's history is unaffected by another chat's reset. Verify the test passes under `node --test`.
- [ ] 5.2 Confirm `data/history.db` (and any temp/test db files) are covered by the existing `data/` gitignore entry — verify with `git status` after running the test suite that no db file appears as untracked.
- [ ] 5.3 Run the full test suite and `tsc` build and confirm both pass with the new module included.
