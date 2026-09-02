import type { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCHEMA_V1_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url));

export interface Migration {
  version: number;
  up: (db: DatabaseSync) => void;
}

export const MIGRATIONS: Migration[] = [
  { version: 1, up: (db) => db.exec(readFileSync(SCHEMA_V1_PATH, 'utf8')) },
];

/**
 * Applies any pending migrations to `db`, bringing it to the latest schema version while
 * preserving existing data. `migrations` defaults to the production `MIGRATIONS` list;
 * tests pass a custom list to exercise the runner against fixture migrations.
 */
export function migrate(db: DatabaseSync, migrations: Migration[] = MIGRATIONS): void {
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

  for (const migration of migrations) {
    if (migration.version <= current) continue;

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
