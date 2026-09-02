## Why

The `agent-stats` capability (`add-sqlite-stats`, pending archive) currently bootstraps its SQLite database with `CREATE TABLE IF NOT EXISTS` only — an explicit design decision to accept "the user drops `data/stats.db` and it gets recreated" whenever the schema changes. That's fine for a throwaway local database, but it silently destroys any accumulated history (token usage, latency trends) the moment a future change touches the schema, with no way to opt out. As more stats-related changes land (`add-classifier-routing`, `add-parallel-subagents` both extend `llm_calls.role` usage), the odds of needing a schema change keep growing, and losing history on every one of them defeats the purpose of long-running observability.

## What Changes

- Add a lightweight schema-versioning mechanism to the stats database using SQLite's built-in `PRAGMA user_version` (no new table, no external dependency).
- Introduce an ordered list of migration steps in code; on every database open (recorder and reporter), any migration with a version higher than the database's current `user_version` is applied in order, then `user_version` is updated. The existing `schema.sql` becomes migration version 1 (the baseline schema, unchanged).
- Existing rows in `messages`, `llm_calls`, and `tool_calls` are preserved across a migration — a schema change becomes an additive/alter step, not a drop-and-recreate.
- Document, for future contributors, how to add a new migration when the schema needs to change.
- Non-goal: no down-migrations (rollback). If a migration needs to be reverted, restoring from a backup or dropping `data/stats.db` remains the fallback, same as before.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `agent-stats`: gains a new requirement that schema changes are applied via versioned migrations that preserve existing data, replacing the current "drop the database file" story for schema evolution.

## Impact

- `src/stats/schema.sql`: reorganized as migration version 1 (or kept as-is and referenced by the version-1 migration step — exact shape decided in design.md).
- New: `src/stats/migrations.ts` (or similar) — ordered migration definitions and the runner that applies them against a `DatabaseSync`.
- `src/stats/sqlite-recorder.ts` and `src/stats/reporter.ts`: both open a database and currently run `schema.sql` directly — both switch to running the migration runner instead.
- `README.md`: update the "Statistics" section's guidance from "drop `data/stats.db` when the schema changes" to "migrations run automatically; no manual reset needed."
- No new external dependencies — `node:sqlite`'s `PRAGMA` support covers this.
- Tests: new `test/stats/migrations.test.ts` covering a fresh database (runs from version 0), an up-to-date database (no-op), and a database with existing rows surviving a schema-adding migration.
