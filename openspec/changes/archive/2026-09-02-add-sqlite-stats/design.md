## Context

See proposal.md — Why. Change 1 (`add-docker-sandboxed-tool-use`) defines the `StatsRecorder` interface (`src/stats/types.ts`), the `usage?` field on `LlmResult` (filled by `OllamaConnector` from `prompt_eval_count`/`eval_count`), and `statsRecorder?` as an optional orchestrator dependency (defaulted to `undefined`). This change implements the interface and wires it in. The orchestrator's hook points (`recordMessage`, `recordLlmCall`, `recordToolCall`) are already in place — this change does not modify the orchestrator.

Node 24+ ships `node:sqlite` (`DatabaseSync`, `StatementSync`) as a built-in — no `npm install` needed. The project already uses built-in modules over third-party packages (`fetch` over HTTP SDKs, `process.loadEnvFile` over `dotenv`).

## Goals / Non-Goals

**Goals:**
- Implement `StatsRecorder` with `node:sqlite` — zero new dependencies.
- Record per-model token usage (prompt + completion tokens, from Ollama's real counts).
- Per-role tracking (`main` now; `classifier` and `subagent` added by later changes).
- Markdown report generation from the database.
- `data/` directory gitignored — confidential data stays local.

**Non-Goals:**
- Grafana setup automation — documented as optional, but the user sets it up manually if desired.
- Real-time streaming of stats — fire-and-forget writes are sufficient.
- Stats retention/cleanup policy — the database grows indefinitely; a cleanup command can be added later if needed.
- Modifying the orchestrator — hook points already exist from change 1.

## Decisions

### 1. `node:sqlite` `DatabaseSync` (synchronous API)

`node:sqlite` exposes `DatabaseSync` — a synchronous SQLite binding. Synchronous is fine for stats writes because:
- Writes are small (one row, a few columns) and fast (<1ms on local disk).
- The recorder is called fire-and-forget (async wrapper around sync DB call), so the orchestrator never awaits the DB.
- Synchronous avoids the complexity of a worker thread or async callback queue for what is a trivial write.

- Alternative considered: a queue + batch writes — rejected; premature optimization for a low-volume bot (one message at a time, not thousands/sec).

### 2. Fire-and-forget wrapper

```
class SqliteStatsRecorder implements StatsRecorder {
  recordMessage(stats: MessageStats): void {
    // Do not await — fire and forget
    void this.write(() => this.insertMessage(stats))
  }
  private async write(fn: () => void): Promise<void> {
    try { fn() }
    catch (e) { logger.warn('Stats write failed', { error: ... }) }
  }
}
```

The `void` prefix makes it clear the promise is intentionally not awaited. The `try/catch` inside ensures a DB error never propagates to the orchestrator.

- Alternative considered: make `recordMessage` async and await it in the orchestrator — rejected; the spec says stats must not block the orchestrator, and an `await` on every hook point would add latency.

### 3. Schema: three tables, foreign-keyed

```sql
CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp       TEXT NOT NULL,        -- ISO 8601
  chat_id         INTEGER NOT NULL,
  prompt_text     TEXT,                 -- may be null for privacy mode
  reply_text      TEXT,
  total_ms        INTEGER NOT NULL,
  iterations      INTEGER NOT NULL DEFAULT 0,
  tool_calls      INTEGER NOT NULL DEFAULT 0,
  ok              INTEGER NOT NULL,     -- 0 or 1
  reason          TEXT                  -- failure reason, null on success
);

CREATE TABLE IF NOT EXISTS llm_calls (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id      INTEGER NOT NULL REFERENCES messages(id),
  call_index      INTEGER NOT NULL,     -- 0, 1, 2... within the message
  role            TEXT NOT NULL,        -- "main" | "classifier" | "subagent"
  model           TEXT NOT NULL,
  prompt_tokens   INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms      INTEGER NOT NULL,
  ok              INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id      INTEGER NOT NULL REFERENCES messages(id),
  llm_call_id     INTEGER,              -- nullable: tool calls are linked to the message, may or may not link to an llm_call
  tool_name       TEXT NOT NULL,
  args_json       TEXT NOT NULL,
  latency_ms      INTEGER NOT NULL,
  ok              INTEGER NOT NULL,
  result_len      INTEGER NOT NULL DEFAULT 0
);
```

`role` is the key field for per-role token breakdowns. Change 1 writes `role="main"`; change 3 adds `role="classifier"`; change 4 adds `role="subagent"`.

### 4. Report generation: SQL queries → Markdown

The `StatsReporter` runs a fixed set of SQL queries and formats the results as Markdown tables:

```sql
-- Per-model token totals
SELECT model,
       SUM(prompt_tokens) AS input_tokens,
       SUM(completion_tokens) AS output_tokens,
       SUM(prompt_tokens + completion_tokens) AS total_tokens,
       COUNT(*) AS calls
FROM llm_calls GROUP BY model ORDER BY total_tokens DESC;

-- Per-role breakdown
SELECT role, SUM(prompt_tokens + completion_tokens) AS tokens
FROM llm_calls GROUP BY role;

-- Latency per model
SELECT model, AVG(latency_ms) AS avg_ms, MIN(latency_ms), MAX(latency_ms)
FROM llm_calls GROUP BY model;

-- Overall success rate
SELECT
  COUNT(*) AS total,
  SUM(ok) AS succeeded,
  ROUND(100.0 * SUM(ok) / COUNT(*), 1) AS success_pct
FROM messages;

-- Tool usage
SELECT tool_name, COUNT(*) AS calls, SUM(ok) AS succeeded, AVG(latency_ms) AS avg_ms
FROM tool_calls GROUP BY tool_name;
```

Output file: `data/stats-report.md` (gitignored). Written using `node:fs/promises` `writeFile`.

### 5. `prompt_text` in the database — privacy concern

The `prompt_text` column stores the user's message text. This is sensitive (could contain personal data). Options:
- **Store it** (default) — useful for debugging and analyzing what kinds of messages go to which model. The DB is gitignored, so it stays local.
- **Do not store it** — set `STATS_STORE_PROMPTS=false` in env, column is null. For privacy-sensitive deployments.

Default: store. The user explicitly asked for stats, and the data is local-only (gitignored).

### 6. No schema migrations

`CREATE TABLE IF NOT EXISTS` runs on every startup. No migration system — if the schema changes in a later change, the user drops `data/stats.db` (it's all derived data). This is acceptable because stats are ephemeral observability data, not source-of-truth records.

## Risks / Trade-offs

- [`node:sqlite` is experimental in Node 24] → Accepted; it's a built-in, stable enough for local stats, and the API surface used (`DatabaseSync`, `prepare`, `run`) is simple. If it breaks in a future Node version, the `SqliteStatsRecorder` is isolated behind the `StatsRecorder` interface and can be swapped.
- [Synchronous DB calls on the main thread] → Accepted; writes are <1ms, fire-and-forget, and the bot processes one message at a time (not high-throughput). If this becomes a bottleneck, a worker thread can be added later without changing the interface.
- [Database grows indefinitely] → Accepted for now; a `stats:cleanup` command or retention policy can be added later. The user can manually delete `data/stats.db` to reset.

## Open Questions

(none)
