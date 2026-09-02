## 1. Migration Runner

- [x] 1.1 Create `src/stats/migrations.ts` defining the `Migration` shape (`{ version: number; up: (db: DatabaseSync) => void }`), a `MIGRATIONS` array with a single entry `{ version: 1, up: ... }` that runs today's `src/stats/schema.sql`, and an exported `migrate(db: DatabaseSync): void` that reads `PRAGMA user_version`, applies each pending migration in a `BEGIN`/`COMMIT` transaction (rolling back and re-throwing on error), and updates `PRAGMA user_version` after each one. Verify: `tsc --noEmit` passes.
- [x] 1.2 Unit test `migrate()` against a fresh in-tmp-file database: starts at `user_version = 0`, ends at `user_version = 1`, and all three tables (`messages`, `llm_calls`, `tool_calls`) exist. Verify: `npm test` passes.
- [x] 1.3 Unit test `migrate()` is a no-op when the database is already at the latest version: run it twice against the same file, assert no error and `user_version` unchanged. Verify: `npm test` passes.
- [x] 1.4 Unit test `migrate()` preserves existing rows when a second migration is appended: add a temporary `{ version: 2, up: (db) => db.exec('ALTER TABLE messages ADD COLUMN test_col TEXT') }` fixture migration in the test file (not in production `MIGRATIONS`), insert a row at version 1, run `migrate()` again with the version-2 migration included, and assert the pre-existing row's original columns are unchanged and still present. Verify: `npm test` passes.
- [x] 1.5 Unit test `migrate()` rolls back cleanly when a migration throws: a fixture migration whose `up()` throws leaves `user_version` unchanged and does not partially apply its SQL. Verify: `npm test` passes.

## 2. Wire Into Recorder and Reporter

- [x] 2.1 Update `src/stats/sqlite-recorder.ts`'s constructor to call `migrate(db)` instead of `db.exec(readFileSync(SCHEMA_PATH, 'utf8'))`, keeping the existing try/catch (a migration failure is logged as a warning and disables recording for that process, per the existing task 2.4 behavior from `add-sqlite-stats`). Verify: `tsc --noEmit` passes, and the existing `test/stats/sqlite-recorder.test.ts` suite still passes unchanged.
- [x] 2.2 Update `src/stats/reporter.ts`'s `generateReport` to call `migrate(db)` instead of `db.exec(await readFile(SCHEMA_PATH, 'utf8'))`. Verify: `tsc --noEmit` passes, and the existing `test/stats/reporter.test.ts` suite still passes unchanged.

## 3. Documentation

- [x] 3.1 Update the "Statistics" section of `README.md`: replace the (implicit) guidance that a schema change requires deleting `data/stats.db` with a short note that migrations run automatically on startup, plus a one-paragraph "adding a migration" pointer to `src/stats/migrations.ts` for future contributors. Verify: README reflects the new behavior.

## 4. Final Verification

- [x] 4.1 Run `npm test` and confirm all tests pass. Verify: `npm test` exits 0.
- [x] 4.2 Run `tsc --noEmit`. Verify: no type errors.
- [x] 4.3 Manually verify end-to-end: create a `data/stats.db` at version 1 with the recorder, add a throwaway `{ version: 2, ... }` migration locally, restart, and confirm existing rows survive and `PRAGMA user_version` reads `2`. Revert the throwaway migration afterward — it must not ship. Verify: observed behavior matches, and `git diff` shows no leftover fixture migration.
