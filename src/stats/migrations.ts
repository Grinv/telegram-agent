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
  {
    version: 2,
    up: (db) =>
      db.exec(`
        ALTER TABLE llm_calls RENAME COLUMN prompt_tokens TO input_tokens;
        ALTER TABLE llm_calls RENAME COLUMN completion_tokens TO output_tokens;
        ALTER TABLE llm_calls RENAME COLUMN call_index TO turn_number;
        ALTER TABLE llm_calls RENAME COLUMN latency_ms TO latency;
        ALTER TABLE llm_calls ADD COLUMN timestamp TEXT;
        ALTER TABLE llm_calls ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'main';
        ALTER TABLE llm_calls ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE llm_calls ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE llm_calls ADD COLUMN usage_detail_reported INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE llm_calls ADD COLUMN estimated_cost REAL NOT NULL DEFAULT 0;
        ALTER TABLE llm_calls ADD COLUMN priced INTEGER NOT NULL DEFAULT 0;

        ALTER TABLE tool_calls RENAME COLUMN result_len TO output_size;
        ALTER TABLE tool_calls RENAME COLUMN latency_ms TO duration;
        ALTER TABLE tool_calls ADD COLUMN input_size INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE tool_calls ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
      `),
  },
  {
    version: 3,
    up: (db) =>
      db.exec(`
        ALTER TABLE llm_calls ADD COLUMN instruction_tokens INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE llm_calls ADD COLUMN user_request_tokens INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE llm_calls ADD COLUMN conversation_tokens INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE llm_calls ADD COLUMN tool_output_tokens INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE llm_calls ADD COLUMN repeated_input_tokens INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE llm_calls ADD COLUMN new_input_tokens INTEGER NOT NULL DEFAULT 0;
      `),
  },
  {
    // Tool definitions (LlmRequest.tools) are now attributed to their own
    // content category and counted in repeated-input, rather than being
    // silently spread across the four categories above and omitted from
    // repetition. `tool_definition_tokens` carries the new figure;
    // `attribution_version` marks which method a row was computed under (0:
    // rows written before this migration, under the old attribution; 1: rows
    // written after it) so views can tell the two apart rather than
    // averaging them together. See openspec/changes/fix-context-attribution.
    version: 4,
    up: (db) =>
      db.exec(`
        ALTER TABLE llm_calls ADD COLUMN tool_definition_tokens INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE llm_calls ADD COLUMN attribution_version INTEGER NOT NULL DEFAULT 0;
      `),
  },
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
