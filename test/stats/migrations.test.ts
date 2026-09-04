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

    assert.equal(userVersion(db), 4);
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
    assert.equal(userVersion(db), 4);

    assert.doesNotThrow(() => migrate(db));
    assert.equal(userVersion(db), 4);
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
      version: 5,
      up: (database) => database.exec('ALTER TABLE messages ADD COLUMN test_col TEXT'),
    };

    migrate(db, [...MIGRATIONS, fixtureMigration]);

    assert.equal(userVersion(db), 5);

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

test('a fresh database ends at the latest version with every renamed and added column present', () => {
  const db = new DatabaseSync(tmpDbPath());
  try {
    migrate(db);
    assert.equal(userVersion(db), 4);

    const llmColumns = (db.prepare('PRAGMA table_info(llm_calls)').all() as Array<{ name: string }>).map(
      (c) => c.name
    );
    for (const column of [
      'input_tokens',
      'output_tokens',
      'turn_number',
      'latency',
      'timestamp',
      'agent_id',
      'cached_tokens',
      'reasoning_tokens',
      'usage_detail_reported',
      'estimated_cost',
      'priced',
      'instruction_tokens',
      'user_request_tokens',
      'conversation_tokens',
      'tool_output_tokens',
      'repeated_input_tokens',
      'new_input_tokens',
      'tool_definition_tokens',
      'attribution_version',
    ]) {
      assert.ok(llmColumns.includes(column), `expected llm_calls to have column ${column}`);
    }
    for (const column of ['prompt_tokens', 'completion_tokens', 'call_index', 'latency_ms']) {
      assert.ok(!llmColumns.includes(column), `expected llm_calls to no longer have column ${column}`);
    }

    const toolColumns = (db.prepare('PRAGMA table_info(tool_calls)').all() as Array<{ name: string }>).map(
      (c) => c.name
    );
    for (const column of ['output_size', 'duration', 'input_size', 'output_tokens']) {
      assert.ok(toolColumns.includes(column), `expected tool_calls to have column ${column}`);
    }
    for (const column of ['result_len', 'latency_ms']) {
      assert.ok(!toolColumns.includes(column), `expected tool_calls to no longer have column ${column}`);
    }
  } finally {
    db.close();
  }
});

test('a database migrated from version 1 with existing rows retains them under the renamed columns', () => {
  const db = new DatabaseSync(tmpDbPath());
  try {
    migrate(db, [MIGRATIONS[0]]);
    assert.equal(userVersion(db), 1);

    db.exec(
      `INSERT INTO messages (timestamp, chat_id, prompt_text, total_ms, iterations, tool_calls, ok, reason)
       VALUES ('2024-01-01T00:00:00.000Z', 42, 'hello', 100, 1, 1, 1, NULL)`
    );
    const messageId = Number(
      (db.prepare('SELECT id FROM messages').get() as { id: number }).id
    );
    db.prepare(
      `INSERT INTO llm_calls (message_id, call_index, role, model, prompt_tokens, completion_tokens, latency_ms, ok)
       VALUES (?, 0, 'main', 'llama3', 12, 4, 250, 1)`
    ).run(messageId);
    const llmCallId = Number(
      (db.prepare('SELECT id FROM llm_calls').get() as { id: number }).id
    );
    db.prepare(
      `INSERT INTO tool_calls (message_id, llm_call_id, tool_name, args_json, latency_ms, ok, result_len)
       VALUES (?, ?, 'echo', '{}', 30, 1, 2)`
    ).run(messageId, llmCallId);

    migrate(db);
    assert.equal(userVersion(db), 4);

    const llmCall = db.prepare('SELECT * FROM llm_calls').get() as Record<string, unknown>;
    assert.equal(llmCall.input_tokens, 12);
    assert.equal(llmCall.output_tokens, 4);
    assert.equal(llmCall.turn_number, 0);
    assert.equal(llmCall.latency, 250);

    const toolCall = db.prepare('SELECT * FROM tool_calls').get() as Record<string, unknown>;
    assert.equal(toolCall.output_size, 2);
    assert.equal(toolCall.duration, 30);
  } finally {
    db.close();
  }
});

test('migrating an already-current database is a no-op and does not duplicate columns', () => {
  const db = new DatabaseSync(tmpDbPath());
  try {
    migrate(db);
    assert.equal(userVersion(db), 4);

    assert.doesNotThrow(() => migrate(db));
    assert.equal(userVersion(db), 4);

    const llmColumns = db.prepare('PRAGMA table_info(llm_calls)').all() as Array<{ name: string }>;
    const names = llmColumns.map((c) => c.name);
    assert.equal(names.length, new Set(names).size, 'expected no duplicate columns');
  } finally {
    db.close();
  }
});

test('rolls back cleanly when a migration throws, leaving the version and schema unchanged', () => {
  const db = new DatabaseSync(tmpDbPath());
  try {
    migrate(db);
    assert.equal(userVersion(db), 4);

    const failingMigration: Migration = {
      version: 5,
      up: (database) => {
        database.exec('ALTER TABLE messages ADD COLUMN test_col TEXT');
        throw new Error('boom');
      },
    };

    assert.throws(() => migrate(db, [...MIGRATIONS, failingMigration]), /boom/);

    assert.equal(userVersion(db), 4);
    const columns = db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>;
    assert.ok(!columns.some((column) => column.name === 'test_col'));
  } finally {
    db.close();
  }
});

test('a database populated at the previous version (3) preserves every existing row across messages, llm_calls and tool_calls when migrated to the current version', () => {
  const db = new DatabaseSync(tmpDbPath());
  try {
    migrate(db, MIGRATIONS.filter((m) => m.version <= 3));
    assert.equal(userVersion(db), 3);

    db.exec(
      `INSERT INTO messages (timestamp, chat_id, prompt_text, reply_text, total_ms, iterations, tool_calls, ok, reason)
       VALUES ('2024-01-01T00:00:00.000Z', 42, 'hello', 'hi there', 500, 2, 1, 1, NULL)`
    );
    const messageId = Number((db.prepare('SELECT id FROM messages').get() as { id: number }).id);

    db.prepare(
      `INSERT INTO llm_calls (
         message_id, turn_number, role, agent_id, model, input_tokens, output_tokens, latency, ok,
         timestamp, cached_tokens, reasoning_tokens, usage_detail_reported, estimated_cost, priced,
         instruction_tokens, user_request_tokens, conversation_tokens, tool_output_tokens,
         repeated_input_tokens, new_input_tokens
       )
       VALUES (?, 0, 'main', 'main', 'llama3', 100, 40, 250, 1, '2024-01-01T00:00:01.000Z', 0, 0, 0, 0.001, 1, 60, 20, 10, 10, 0, 100)`
    ).run(messageId);
    const llmCallId = Number((db.prepare('SELECT id FROM llm_calls').get() as { id: number }).id);

    db.prepare(
      `INSERT INTO tool_calls (message_id, llm_call_id, tool_name, args_json, duration, ok, output_size, input_size, output_tokens)
       VALUES (?, ?, 'search', '{}', 15, 1, 25, 2, 7)`
    ).run(messageId, llmCallId);

    migrate(db);
    assert.equal(userVersion(db), 4);

    const message = db.prepare('SELECT * FROM messages').get() as Record<string, unknown>;
    assert.equal(message.chat_id, 42);
    assert.equal(message.prompt_text, 'hello');
    assert.equal(message.reply_text, 'hi there');
    assert.equal(message.total_ms, 500);
    assert.equal(message.ok, 1);

    const llmCall = db.prepare('SELECT * FROM llm_calls').get() as Record<string, unknown>;
    assert.equal(llmCall.model, 'llama3');
    assert.equal(llmCall.input_tokens, 100);
    assert.equal(llmCall.output_tokens, 40);
    assert.equal(llmCall.instruction_tokens, 60);
    assert.equal(llmCall.repeated_input_tokens, 0);
    assert.equal(llmCall.new_input_tokens, 100);
    // New columns land on their migration default for a row written before they existed,
    // rather than the row being dropped or its other fields being disturbed.
    assert.equal(llmCall.tool_definition_tokens, 0);
    assert.equal(llmCall.attribution_version, 0);

    const toolCall = db.prepare('SELECT * FROM tool_calls').get() as Record<string, unknown>;
    assert.equal(toolCall.tool_name, 'search');
    assert.equal(toolCall.output_size, 25);
    assert.equal(toolCall.output_tokens, 7);
  } finally {
    db.close();
  }
});
