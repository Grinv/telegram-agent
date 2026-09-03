import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteHistoryStore } from '../../src/history/sqlite-store.js';

function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'history-store-test-'));
  return join(dir, 'history.db');
}

test('append then get returns turns in order', () => {
  const store = new SqliteHistoryStore(tmpDbPath());

  store.appendTurn(1, { role: 'user', content: 'hi', senderId: 100, senderName: 'Alice' });
  store.appendTurn(1, { role: 'assistant', content: 'hello there' });
  store.appendTurn(1, { role: 'user', content: 'how are you?', senderId: 100, senderName: 'Alice' });

  const history = store.getHistory(1);

  assert.equal(history.length, 3);
  assert.deepEqual(
    history.map((t) => t.content),
    ['hi', 'hello there', 'how are you?']
  );
  assert.equal(history[0].senderId, 100);
  assert.equal(history[0].senderName, 'Alice');
  assert.equal(history[1].senderId, undefined);
  assert.equal(history[1].senderName, undefined);
});

test('turns from different chat_ids do not leak into each other\'s getHistory', () => {
  const store = new SqliteHistoryStore(tmpDbPath());

  store.appendTurn(1, { role: 'user', content: 'chat one' });
  store.appendTurn(2, { role: 'user', content: 'chat two' });

  assert.deepEqual(store.getHistory(1).map((t) => t.content), ['chat one']);
  assert.deepEqual(store.getHistory(2).map((t) => t.content), ['chat two']);
});

test('clearHistory empties one chat without affecting another', () => {
  const store = new SqliteHistoryStore(tmpDbPath());

  store.appendTurn(1, { role: 'user', content: 'chat one' });
  store.appendTurn(2, { role: 'user', content: 'chat two' });

  store.clearHistory(1);

  assert.deepEqual(store.getHistory(1), []);
  assert.deepEqual(store.getHistory(2).map((t) => t.content), ['chat two']);
});

test('clearHistory on an empty chat does not throw', () => {
  const store = new SqliteHistoryStore(tmpDbPath());

  assert.doesNotThrow(() => store.clearHistory(999));
  assert.deepEqual(store.getHistory(999), []);
});

test('a new chat with no prior turns returns an empty history', () => {
  const store = new SqliteHistoryStore(tmpDbPath());

  assert.deepEqual(store.getHistory(42), []);
});

test('history survives reopening the same db file (restart)', () => {
  const dbPath = tmpDbPath();
  const store1 = new SqliteHistoryStore(dbPath);
  store1.appendTurn(1, { role: 'user', content: 'before restart' });

  const store2 = new SqliteHistoryStore(dbPath);
  assert.deepEqual(store2.getHistory(1).map((t) => t.content), ['before restart']);
});
