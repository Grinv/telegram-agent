import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../src/history/migrations.js';

function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'history-migrations-test-'));
  return join(dir, 'history.db');
}

function userVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

test('migrates a fresh database from version 0 to the latest version, creating the turns table', () => {
  const db = new DatabaseSync(tmpDbPath());
  try {
    assert.equal(userVersion(db), 0);

    migrate(db);

    assert.equal(userVersion(db), 1);
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'turns'`)
      .get();
    assert.ok(row, 'expected table turns to exist');
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
