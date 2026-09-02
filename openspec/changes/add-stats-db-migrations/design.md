## Context

See proposal.md — Why. Both `SqliteStatsRecorder` (`src/stats/sqlite-recorder.ts`) and `StatsReporter` (`src/stats/reporter.ts`) currently open a `DatabaseSync` and immediately `db.exec(readFileSync('schema.sql'))` — a single, non-versioned `CREATE TABLE IF NOT EXISTS` bootstrap. `node:sqlite`'s `DatabaseSync` exposes arbitrary `PRAGMA` execution via `db.exec`/`db.prepare`, including `PRAGMA user_version`, a 32-bit integer SQLite reserves specifically for application-defined schema versioning (persisted in the database file header, no extra table needed).

## Goals / Non-Goals

**Goals:**
- Preserve existing rows across a schema change.
- Zero new dependencies — built on `node:sqlite` only.
- Keep the migration list simple enough that adding one is a five-minute, low-risk change.

**Non-Goals:**
- Down-migrations / rollback. If a migration must be undone, restoring a file-system backup or deleting `data/stats.db` (accepting data loss) remains the fallback — same as today.
- Concurrent-writer-safe migrations (e.g. multiple bot instances migrating the same file at once). Out of scope — the bot is a single process against a local file, per existing project assumptions.
- Retroactively backfilling new columns with derived values. A migration adds a column with a sensible default (e.g. `0` or `NULL`); it does not need to compute historical values that were never recorded.

## Decisions

### 1. `PRAGMA user_version` over a `schema_migrations` table

SQLite reserves a header field for exactly this purpose (`PRAGMA user_version`), readable/writable as a plain integer via `db.prepare('PRAGMA user_version').get()` / `db.exec('PRAGMA user_version = N')`. Using it avoids creating and maintaining an extra table, and avoids the bootstrapping chicken-and-egg problem of "which table tracks whether the tracking table itself exists."

- Alternative considered: a `schema_migrations(version INTEGER, applied_at TEXT)` table — rejected as unnecessary ceremony for a single-file, single-writer local database where "current version" is all that's ever needed (no audit trail requirement).

### 2. Migration list: ordered array of `{ version, up }` in code

```ts
// src/stats/migrations.ts
interface Migration {
  version: number;
  up: (db: DatabaseSync) => void;
}

const MIGRATIONS: Migration[] = [
  { version: 1, up: (db) => db.exec(readFileSync(SCHEMA_V1_PATH, 'utf8')) },
  // { version: 2, up: (db) => db.exec('ALTER TABLE llm_calls ADD COLUMN ...') },
];

export function migrate(db: DatabaseSync): void {
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (const migration of MIGRATIONS) {
    if (migration.version > current) {
      db.exec('BEGIN');
      try {
        migration.up(db);
        db.exec(`PRAGMA user_version = ${migration.version}`);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  }
}
```

Version 1's `up` is exactly today's `schema.sql` (`CREATE TABLE IF NOT EXISTS` — idempotent, so it's also safe as the initial migration for a brand-new database going from version 0 straight to the latest). Both `SqliteStatsRecorder` and `StatsReporter` call `migrate(db)` once, right after opening the connection, replacing their current direct `db.exec(schemaSql)` call.

- Alternative considered: encode each migration as a raw `.sql` file under `src/stats/migrations/NNN_description.sql`, loaded and run in filename order — rejected as marginally more ceremony (file naming convention, directory scanning) for no real benefit at this scale; a plain TS array is easier to review in a diff and lets a migration mix SQL with any necessary JS logic (e.g. computing a default from existing data before adding a `NOT NULL` column).

### 3. `PRAGMA user_version` writes are part of the same transaction as the migration

Wrapping each migration's `up()` and its version bump in one `BEGIN`/`COMMIT` (with `ROLLBACK` on error) ensures a crash mid-migration can't leave the database at a version number that doesn't match its actual schema (e.g. version bumped but the `ALTER TABLE` never ran, or vice versa).

### 4. Failure mode: a migration throws

If `migration.up()` throws (bad SQL, unexpected pre-existing state), the transaction rolls back and `migrate()` re-throws. Both call sites (`SqliteStatsRecorder`'s constructor, `StatsReporter.generateReport`) already have failure-handling around database setup: the recorder's constructor already wraps its entire setup in try/catch and logs+disables recording on failure (per `add-sqlite-stats`'s task 2.4); a migration failure is treated the same way — stats recording is disabled for that process rather than crashing the bot. The reporter, which is a one-shot CLI command, lets the error propagate (same as any other reporter failure today) so the user sees it and can investigate `data/stats.db` directly.

## Risks / Trade-offs

- [A hand-written `ALTER TABLE` migration is wrong and corrupts the schema] → Mitigated by the transaction wrapping (a bad migration rolls back cleanly, leaving the old schema intact) and by requiring a test per migration (see tasks.md) before it ships.
- [Migration list grows unbounded over the years] → Accepted; each entry is a few lines, and pruning very old migrations would itself risk breaking a long-lived database that skipped several versions — not worth the complexity at this project's scale.
- [`PRAGMA user_version` is a single global integer — no per-table versioning] → Accepted; the whole database is versioned as one unit, consistent with how the three tables are already managed as one `schema.sql`.
