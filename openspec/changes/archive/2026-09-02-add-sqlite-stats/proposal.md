## Why

Change 1 (`add-docker-sandboxed-tool-use`) adds the `StatsRecorder` interface and `usage?` field as forward-compatibility hooks, but leaves them unimplemented (`statsRecorder` is `undefined`). Without a real recorder, there is no way to measure token usage, latency, or tool-use patterns — the user needs per-model token accounting (which model spent how many tokens) and before/after comparison statistics. SQLite is built into Node 24+ (`node:sqlite`), so this requires zero external dependencies, consistent with the project's no-SDK convention.

## What Changes

- Implement `SqliteStatsRecorder` (implements the `StatsRecorder` interface from change 1) using `node:sqlite`'s `DatabaseSync`. Writes to `data/stats.db` (gitignored — confidential, local only).
- Create a database schema with three tables: `messages` (per-message stats: latency, iterations, success), `llm_calls` (per-LLM-call stats: model, token counts, latency, role), and `tool_calls` (per-tool-call stats: tool name, args, latency, result).
- Wire `SqliteStatsRecorder` into the orchestrator as the `statsRecorder` dependency (previously `undefined`). The orchestrator code does not change — it already calls `statsRecorder?.record*()` at hook points.
- Add `StatsReporter` that reads the SQLite database and generates a Markdown report (per-model token totals, per-role breakdown, average latency, success rate, tool usage). Output is a `.md` file written to `data/stats-report.md` (gitignored).
- Add `npm run stats:report` script to generate the report.
- Add Grafana SQLite datasource configuration documentation (optional, for live dashboards).
- Ensure `data/` directory and `data/stats.db` are gitignored (`.gitignore` updated).
- The `role` field in `llm_calls` distinguishes `main` (orchestrator loop calls), `classifier` (routing calls — added by change 3), and `subagent` (nested loop calls — added by change 4). This change only writes `role: "main"`.

## Capabilities

### New Capabilities
- `agent-stats`: Persistent statistics recording (SQLite) for agent operation — per-message, per-LLM-call, and per-tool-call metrics including model, token counts, latency, and role; with Markdown report generation.

### Modified Capabilities
(none — the `StatsRecorder` interface and hook points already exist in `bot-orchestrator` after change 1; this change only provides the implementation and wires it in.)

## Impact

- New: `src/stats/sqlite-recorder.ts` — `SqliteStatsRecorder` implementing `StatsRecorder` from `src/stats/types.ts`.
- New: `src/stats/schema.sql` — `CREATE TABLE` statements for `messages`, `llm_calls`, `tool_calls`.
- New: `src/stats/reporter.ts` — `StatsReporter` that queries the database and writes a `.md` report.
- New: `src/stats/index.ts` — factory `createStatsRecorder(dbPath)` and `createStatsReporter(dbPath)`.
- `src/index.ts`: wires `SqliteStatsRecorder` into `createMessageHandler` as the `statsRecorder` dep (was `undefined` after change 1).
- `src/config.ts`: adds `statsDbPath` field (env `STATS_DB_PATH`, default `data/stats.db`).
- `.gitignore`: adds `data/` directory.
- `package.json`: adds `stats:report` script.
- `README.md`: documents stats recording, `npm run stats:report`, and the `data/` directory.
- No external npm dependencies — `node:sqlite` is a Node 24+ built-in.
- Tests: new `test/stats/` directory with `sqlite-recorder.test.ts` (uses a tmp DB file) and `reporter.test.ts` (uses a pre-populated in-memory DB).
