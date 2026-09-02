import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate, MIGRATIONS, type Migration } from '../../src/stats/migrations.js';

function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stats-migrations-test-'));
  return join(dir, 'stats.db');
}

function userVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

test('migrates a fresh database from version 0 to the latest version, creating all tables', () => {
  const db = new DatabaseSync(tmpDbPath());
  try {
    assert.equal(userVersion(db), 0);

    migrate(db);

    assert.equal(userVersion(db), 1);
    for (const table of ['messages', 'llm_calls', 'tool_calls']) {
      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
        .get(table);
      assert.ok(row, `expected table ${table} to exist`);
    }
  } finally {
    db.close();
  }
});

test('is a no-op when the database is already at the latest version', () => {
  const db = new DatabaseSync(tmpDbPath());
  try {
    migrate(db);
    assert.equal(userVersion(db), 1);

    assert.doesNotThrow(() => migrate(db));
    assert.equal(userVersion(db), 1);
  } finally {
    db.close();
  }
});

test('preserves existing rows when a new migration is appended', () => {
  const db = new DatabaseSync(tmpDbPath());
  try {
    migrate(db);

    db.exec(
      `INSERT INTO messages (timestamp, chat_id, prompt_text, total_ms, iterations, tool_calls, ok, reason)
       VALUES ('2024-01-01T00:00:00.000Z', 42, 'hello', 100, 1, 0, 1, NULL)`
    );

    const fixtureMigration: Migration = {
      version: 2,
      up: (database) => database.exec('ALTER TABLE messages ADD COLUMN test_col TEXT'),
    };

    migrate(db, [...MIGRATIONS, fixtureMigration]);

    assert.equal(userVersion(db), 2);

    const message = db.prepare('SELECT * FROM messages').get() as Record<string, unknown>;
    assert.equal(message.chat_id, 42);
    assert.equal(message.prompt_text, 'hello');
    assert.equal(message.total_ms, 100);
    assert.equal(message.ok, 1);
    assert.equal(message.test_col, null);
  } finally {
    db.close();
  }
});

test('rolls back cleanly when a migration throws, leaving the version and schema unchanged', () => {
  const db = new DatabaseSync(tmpDbPath());
  try {
    migrate(db);
    assert.equal(userVersion(db), 1);

    const failingMigration: Migration = {
      version: 2,
      up: (database) => {
        database.exec('ALTER TABLE messages ADD COLUMN test_col TEXT');
        throw new Error('boom');
      },
    };

    assert.throws(() => migrate(db, [...MIGRATIONS, failingMigration]), /boom/);

    assert.equal(userVersion(db), 1);
    const columns = db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>;
    assert.ok(!columns.some((column) => column.name === 'test_col'));
  } finally {
    db.close();
  }
});
