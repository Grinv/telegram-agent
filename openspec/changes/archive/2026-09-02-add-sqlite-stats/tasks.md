## 1. Database Schema

- [x] 1.1 Create `src/stats/schema.sql` with `CREATE TABLE IF NOT EXISTS` statements for `messages`, `llm_calls`, and `tool_calls` per design.md. Include foreign keys (`message_id` → `messages.id`, `llm_call_id` → `llm_calls.id`). Verify: file exists, SQL is valid (can be tested with `node:sqlite` `DatabaseSync.exec`).

## 2. SQLite Stats Recorder

- [x] 2.1 Create `src/stats/sqlite-recorder.ts` — `SqliteStatsRecorder` class implementing `StatsRecorder` from `src/stats/types.ts`. Constructor takes `dbPath: string` and `storePrompts: boolean`. On construction, opens the database, runs `schema.sql` (creates tables if missing), and prepares insert statements. `recordMessage`, `recordLlmCall`, `recordToolCall` call a private `write(fn)` wrapper that executes the statement in a `try/catch` (logs warning on failure, never throws). Writes are fire-and-forget (`void this.write(...)`). Verify: `tsc --noEmit` passes.
- [x] 2.2 Unit test `SqliteStatsRecorder` with a tmp database file (`node:os` `tmpdir`): insert a message, insert an LLM call linked to it, insert a tool call linked to it; then read them back with a raw query and assert the values match. Verify: `npm test` passes.
- [x] 2.3 Unit test `SqliteStatsRecorder` handles missing `usage` (prompt_tokens=0, completion_tokens=0) and missing `reason` (null). Verify: `npm test` passes.
- [x] 2.4 Unit test `SqliteStatsRecorder` does not throw when the database path is invalid/unwritable — logs a warning and continues. Verify: `npm test` passes.
- [x] 2.5 Unit test `SqliteStatsRecorder` with `storePrompts=false` writes `null` for `prompt_text` and `reply_text`. Verify: `npm test` passes.

## 3. Stats Reporter

- [x] 3.1 Create `src/stats/reporter.ts` — `StatsReporter` class. Constructor takes `dbPath: string`. Method `generateReport(outputPath: string): Promise<void>` runs the SQL queries from design.md (per-model tokens, per-role breakdown, latency, success rate, tool usage), formats results as Markdown tables, and writes to `outputPath` using `node:fs/promises` `writeFile`. Handle empty database (write "No data" message). Verify: `tsc --noEmit` passes.
- [x] 3.2 Unit test `StatsReporter` with a pre-populated in-memory database (insert known data, then generate report, read the output file, assert it contains the expected model names, token counts, and table headers). Verify: `npm test` passes.
- [x] 3.3 Unit test `StatsReporter` with an empty database generates a report with "No data" and exits successfully. Verify: `npm test` passes.

## 4. Factory & Wiring

- [x] 4.1 Create `src/stats/index.ts` exporting `createStatsRecorder(dbPath: string, storePrompts: boolean): StatsRecorder` and `createStatsReporter(dbPath: string): StatsReporter`. Verify: `tsc --noEmit` passes.
- [x] 4.2 Update `src/config.ts` to add `statsDbPath` (env `STATS_DB_PATH`, default `data/stats.db`) and `statsStorePrompts` (env `STATS_STORE_PROMPTS`, default `true`). Add pure resolver functions (`resolveStatsDbPath`, `resolveStatsStorePrompts`) and unit test them. Verify: config tests pass.
- [x] 4.3 Update `src/index.ts` to create `SqliteStatsRecorder` (or `NoopStatsRecorder` if stats are disabled — see task 4.4) and pass it as the `statsRecorder` dep to `createMessageHandler`. Verify: `tsc --noEmit` passes.
- [x] 4.4 Add a `STATS_ENABLED` env var (default `true`). When `false`, `index.ts` does not create a `SqliteStatsRecorder` and passes `undefined` as `statsRecorder` (same as change 1 behavior). This allows disabling stats without removing code. Add `resolveStatsEnabled` pure function and unit test. Verify: config tests pass.

## 5. .gitignore & npm scripts

- [x] 5.1 Add `data/` to `.gitignore`. Verify: `data/stats.db` does not appear in `git status`.
- [x] 5.2 Add `stats:report` script to `package.json`: `node --import tsx src/stats/reporter-cli.ts` (a thin CLI entrypoint that reads config and calls `StatsReporter.generateReport`). Create `src/stats/reporter-cli.ts`. Verify: `npm run stats:report` runs without error on an empty database.

## 6. Documentation

- [x] 6.1 Update `.env.example` with `STATS_DB_PATH`, `STATS_STORE_PROMPTS`, `STATS_ENABLED` and their defaults. Verify: file contains all new vars.
- [x] 6.2 Update `README.md` — add a "Statistics" section documenting: `npm run stats:report`, the `data/` directory (gitignored, confidential), the `STATS_*` env vars, and optional Grafana setup (SQLite datasource plugin pointing at `data/stats.db`). Verify: README reflects the new functionality.

## 7. Final Verification

- [x] 7.1 Run `npm test` and confirm all tests pass. Verify: `npm test` exits 0.
- [x] 7.2 Run `tsc --noEmit`. Verify: no type errors.
- [x] 7.3 Run `npm run stats:report` on a fresh database (no data) and confirm it generates a report file. Verify: `data/stats-report.md` exists and contains "No data".
