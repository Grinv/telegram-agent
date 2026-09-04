import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStatsRecorder } from '../../src/stats/sqlite-recorder.js';

function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stats-test-'));
  return join(dir, 'stats.db');
}

/** Waits for the fire-and-forget write microtask queued by a record* call to flush. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test('records a message, an llm call, and a tool call, and links them by id', async () => {
  const dbPath = tmpDbPath();
  const recorder = new SqliteStatsRecorder(dbPath, true);

  recorder.recordMessage({ chatId: 42, prompt: 'hello', receivedAt: 1000 });
  await flush();

  recorder.recordLlmCall({
    iteration: 0,
    model: 'llama3',
    ok: true,
    text: 'hi',
    toolCalls: [{ name: 'echo', arguments: { text: 'hi' } }],
    usage: { promptTokens: 12, completionTokens: 4 },
    durationMs: 250,
  });
  await flush();

  recorder.recordToolCall({
    iteration: 0,
    toolCalls: [{ name: 'echo', arguments: { text: 'hi' } }],
    results: [{ ok: true, output: 'hi' }],
    durationMs: 30,
  });
  await flush();

  recorder.recordMessage({ chatId: 42, reply: 'hi', replySentAt: 1500, ok: true, iterations: 1 });
  await flush();

  const db = new DatabaseSync(dbPath);
  try {
    const message = db.prepare('SELECT * FROM messages').get() as Record<string, unknown>;
    assert.equal(message.chat_id, 42);
    assert.equal(message.prompt_text, 'hello');
    assert.equal(message.reply_text, 'hi');
    assert.equal(message.total_ms, 500);
    assert.equal(message.iterations, 1);
    assert.equal(message.tool_calls, 1);
    assert.equal(message.ok, 1);
    assert.equal(message.reason, null);

    const llmCall = db.prepare('SELECT * FROM llm_calls').get() as Record<string, unknown>;
    assert.equal(llmCall.message_id, message.id);
    assert.equal(llmCall.role, 'main');
    assert.equal(llmCall.agent_id, 'main');
    assert.equal(llmCall.model, 'llama3');
    assert.equal(llmCall.input_tokens, 12);
    assert.equal(llmCall.output_tokens, 4);
    assert.equal(llmCall.latency, 250);
    assert.equal(llmCall.ok, 1);

    const toolCall = db.prepare('SELECT * FROM tool_calls').get() as Record<string, unknown>;
    assert.equal(toolCall.message_id, message.id);
    assert.equal(toolCall.llm_call_id, llmCall.id);
    assert.equal(toolCall.tool_name, 'echo');
    assert.equal(toolCall.args_json, JSON.stringify({ text: 'hi' }));
    assert.equal(toolCall.duration, 30);
    assert.equal(toolCall.ok, 1);
    assert.equal(toolCall.output_size, 'hi'.length);
  } finally {
    db.close();
  }
});

test('missing usage and reason default to zero tokens and null reason', async () => {
  const dbPath = tmpDbPath();
  const recorder = new SqliteStatsRecorder(dbPath, true);

  recorder.recordMessage({ chatId: 1, prompt: 'p', receivedAt: 0 });
  await flush();
  recorder.recordLlmCall({ iteration: 0, model: 'stub', ok: true, text: 'x' });
  await flush();
  recorder.recordMessage({ chatId: 1, replySentAt: 10, ok: false, iterations: 1 });
  await flush();

  const db = new DatabaseSync(dbPath);
  try {
    const llmCall = db.prepare('SELECT * FROM llm_calls').get() as Record<string, unknown>;
    assert.equal(llmCall.input_tokens, 0);
    assert.equal(llmCall.output_tokens, 0);

    const message = db.prepare('SELECT * FROM messages').get() as Record<string, unknown>;
    assert.equal(message.ok, 0);
    assert.equal(message.reason, null);
  } finally {
    db.close();
  }
});

test('records the failure reason when the message fails', async () => {
  const dbPath = tmpDbPath();
  const recorder = new SqliteStatsRecorder(dbPath, true);

  recorder.recordMessage({ chatId: 1, prompt: 'p', receivedAt: 0 });
  await flush();
  recorder.recordMessage({ chatId: 1, replySentAt: 10, ok: false, iterations: 5, reason: 'MAX_ITERATIONS' });
  await flush();

  const db = new DatabaseSync(dbPath);
  try {
    const message = db.prepare('SELECT * FROM messages').get() as Record<string, unknown>;
    assert.equal(message.ok, 0);
    assert.equal(message.reason, 'MAX_ITERATIONS');
  } finally {
    db.close();
  }
});

test('does not throw when the database path is unwritable', async () => {
  // A path under a file (not a directory) can never be created/opened.
  const dir = mkdtempSync(join(tmpdir(), 'stats-test-'));
  const blockerFile = join(dir, 'blocker');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(blockerFile, 'not a directory');
  const dbPath = join(blockerFile, 'stats.db');

  const recorder = new SqliteStatsRecorder(dbPath, true);

  assert.doesNotThrow(() => {
    recorder.recordMessage({ chatId: 1, prompt: 'p', receivedAt: 0 });
    recorder.recordLlmCall({ iteration: 0, model: 'stub', ok: true, text: 'x' });
    recorder.recordToolCall({ iteration: 0, toolCalls: [], results: [] });
    recorder.recordMessage({ chatId: 1, replySentAt: 10, ok: true, iterations: 1 });
  });
  await flush();
});

test('each llm call records its own timestamp, and several calls within one message are orderable by it', async () => {
  const dbPath = tmpDbPath();
  const recorder = new SqliteStatsRecorder(dbPath, true);

  recorder.recordMessage({ chatId: 1, prompt: 'p', receivedAt: 0 });
  await flush();
  recorder.recordLlmCall({ iteration: 0, model: 'stub', ok: true, text: 'a', calledAt: 2000 });
  await flush();
  recorder.recordLlmCall({ iteration: 1, model: 'stub', ok: true, text: 'b', calledAt: 1000 });
  await flush();
  recorder.recordMessage({ chatId: 1, replySentAt: 10, ok: true, iterations: 2 });
  await flush();

  const db = new DatabaseSync(dbPath);
  try {
    const rows = db.prepare('SELECT turn_number, timestamp FROM llm_calls ORDER BY timestamp ASC').all() as Array<
      Record<string, unknown>
    >;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].turn_number, 1);
    assert.equal(rows[0].timestamp, new Date(1000).toISOString());
    assert.equal(rows[1].turn_number, 0);
    assert.equal(rows[1].timestamp, new Date(2000).toISOString());
  } finally {
    db.close();
  }
});

test('an llm call whose provider reports token usage records the reported values', async () => {
  const dbPath = tmpDbPath();
  const recorder = new SqliteStatsRecorder(dbPath, true);

  recorder.recordMessage({ chatId: 1, prompt: 'p', receivedAt: 0 });
  await flush();
  recorder.recordLlmCall({
    iteration: 0,
    model: 'llama3',
    ok: true,
    text: 'x',
    usage: { promptTokens: 42, completionTokens: 7 },
    calledAt: 5000,
  });
  await flush();

  const db = new DatabaseSync(dbPath);
  try {
    const llmCall = db.prepare('SELECT * FROM llm_calls').get() as Record<string, unknown>;
    assert.equal(llmCall.input_tokens, 42);
    assert.equal(llmCall.output_tokens, 7);
    assert.equal(llmCall.timestamp, new Date(5000).toISOString());
  } finally {
    db.close();
  }
});

test('an llm call whose provider reports no token usage records zero token counts, not absent ones', async () => {
  const dbPath = tmpDbPath();
  const recorder = new SqliteStatsRecorder(dbPath, true);

  recorder.recordMessage({ chatId: 1, prompt: 'p', receivedAt: 0 });
  await flush();
  recorder.recordLlmCall({ iteration: 0, model: 'stub', ok: true, text: 'x' });
  await flush();

  const db = new DatabaseSync(dbPath);
  try {
    const llmCall = db.prepare('SELECT * FROM llm_calls').get() as Record<string, unknown>;
    assert.equal(llmCall.input_tokens, 0);
    assert.equal(llmCall.output_tokens, 0);
  } finally {
    db.close();
  }
});

test('when the provider reports neither cached nor reasoning counts, those columns are zero and marked unreported', async () => {
  const dbPath = tmpDbPath();
  const recorder = new SqliteStatsRecorder(dbPath, true);

  recorder.recordMessage({ chatId: 1, prompt: 'p', receivedAt: 0 });
  await flush();
  recorder.recordLlmCall({
    iteration: 0,
    model: 'llama3',
    ok: true,
    text: 'x',
    usage: { promptTokens: 10, completionTokens: 2 },
  });
  await flush();

  const db = new DatabaseSync(dbPath);
  try {
    const llmCall = db.prepare('SELECT * FROM llm_calls').get() as Record<string, unknown>;
    assert.equal(llmCall.cached_tokens, 0);
    assert.equal(llmCall.reasoning_tokens, 0);
    assert.equal(llmCall.usage_detail_reported, 0);
  } finally {
    db.close();
  }
});

test('when the provider reports cached and reasoning counts, they are recorded and marked as observed', async () => {
  const dbPath = tmpDbPath();
  const recorder = new SqliteStatsRecorder(dbPath, true);

  recorder.recordMessage({ chatId: 1, prompt: 'p', receivedAt: 0 });
  await flush();
  recorder.recordLlmCall({
    iteration: 0,
    model: 'llama3',
    ok: true,
    text: 'x',
    usage: { promptTokens: 10, completionTokens: 2, cachedTokens: 6, reasoningTokens: 3 },
  });
  await flush();

  const db = new DatabaseSync(dbPath);
  try {
    const llmCall = db.prepare('SELECT * FROM llm_calls').get() as Record<string, unknown>;
    assert.equal(llmCall.cached_tokens, 6);
    assert.equal(llmCall.reasoning_tokens, 3);
    assert.equal(llmCall.usage_detail_reported, 1);
  } finally {
    db.close();
  }
});

test('a turn executing several tool calls records one row per call, each with its own duration and sizes, attributed to that turn', async () => {
  const dbPath = tmpDbPath();
  const recorder = new SqliteStatsRecorder(dbPath, true);

  recorder.recordMessage({ chatId: 1, prompt: 'p', receivedAt: 0 });
  await flush();
  recorder.recordLlmCall({ iteration: 3, model: 'llama3', ok: true, text: '' });
  await flush();
  recorder.recordToolCall({
    iteration: 3,
    toolCalls: [
      { name: 'a', arguments: { x: 1 } },
      { name: 'b', arguments: { y: 'a much longer argument payload than the first call' } },
    ],
    results: [
      { ok: true, output: 'short' },
      { ok: true, output: 'a considerably longer result than the first tool call produced' },
    ],
    durationMs: 42,
  });
  await flush();

  const db = new DatabaseSync(dbPath);
  try {
    const llmCall = db.prepare('SELECT * FROM llm_calls').get() as Record<string, unknown>;
    const rows = db
      .prepare('SELECT * FROM tool_calls WHERE llm_call_id = ? ORDER BY id ASC')
      .all(llmCall.id as number) as Array<Record<string, unknown>>;

    assert.equal(rows.length, 2, 'one row per tool call');
    const [first, second] = rows;
    assert.equal(first.tool_name, 'a');
    assert.equal(second.tool_name, 'b');
    assert.equal(first.duration, 42);
    assert.equal(second.duration, 42);
    assert.notEqual(first.output_size, second.output_size, 'result sizes differ per call');
    assert.notEqual(first.input_size, second.input_size, 'argument sizes differ per call');
    assert.ok((first.output_tokens as number) > 0);
    assert.ok((second.output_tokens as number) > 0);
  } finally {
    db.close();
  }
});

test('an llm call for a priced model records a cost derived from its tokens and price, and is marked priced', async () => {
  const dbPath = tmpDbPath();
  const recorder = new SqliteStatsRecorder(dbPath, true, {
    llama3: { inputPerMillion: 2, outputPerMillion: 4 },
  });

  recorder.recordMessage({ chatId: 1, prompt: 'p', receivedAt: 0 });
  await flush();
  recorder.recordLlmCall({
    iteration: 0,
    model: 'llama3',
    ok: true,
    text: 'x',
    usage: { promptTokens: 1_000_000, completionTokens: 500_000 },
  });
  await flush();

  const db = new DatabaseSync(dbPath);
  try {
    const llmCall = db.prepare('SELECT * FROM llm_calls').get() as Record<string, unknown>;
    assert.equal(llmCall.estimated_cost, 2 + 2);
    assert.equal(llmCall.priced, 1);
  } finally {
    db.close();
  }
});

test('an llm call for a model with no configured price records zero cost and is marked unpriced, not free', async () => {
  const dbPath = tmpDbPath();
  const recorder = new SqliteStatsRecorder(dbPath, true, {});

  recorder.recordMessage({ chatId: 1, prompt: 'p', receivedAt: 0 });
  await flush();
  recorder.recordLlmCall({
    iteration: 0,
    model: 'unlisted-model',
    ok: true,
    text: 'x',
    usage: { promptTokens: 1000, completionTokens: 500 },
  });
  await flush();

  const db = new DatabaseSync(dbPath);
  try {
    const llmCall = db.prepare('SELECT * FROM llm_calls').get() as Record<string, unknown>;
    assert.equal(llmCall.estimated_cost, 0);
    assert.equal(llmCall.priced, 0);
  } finally {
    db.close();
  }
});

test('changing the price table after a call was recorded does not alter that row\'s stored cost', async () => {
  const dbPath = tmpDbPath();
  const priceTable = { llama3: { inputPerMillion: 2, outputPerMillion: 4 } };
  const recorder = new SqliteStatsRecorder(dbPath, true, priceTable);

  recorder.recordMessage({ chatId: 1, prompt: 'p', receivedAt: 0 });
  await flush();
  recorder.recordLlmCall({
    iteration: 0,
    model: 'llama3',
    ok: true,
    text: 'x',
    usage: { promptTokens: 1_000_000, completionTokens: 0 },
  });
  await flush();

  const db = new DatabaseSync(dbPath);
  try {
    const before = db.prepare('SELECT estimated_cost FROM llm_calls').get() as { estimated_cost: number };
    assert.equal(before.estimated_cost, 2);

    // Mutating the table object passed at construction time must not reach
    // back into a row already written.
    priceTable.llama3 = { inputPerMillion: 999, outputPerMillion: 999 };

    const after = db.prepare('SELECT estimated_cost FROM llm_calls').get() as { estimated_cost: number };
    assert.equal(after.estimated_cost, 2, 'previously recorded cost must be unchanged');
  } finally {
    db.close();
  }
});

test('a recorded call\'s tool-definition tokens are written and read back, and the row is marked under the current attribution', async () => {
  const dbPath = tmpDbPath();
  const recorder = new SqliteStatsRecorder(dbPath, true);

  recorder.recordMessage({ chatId: 1, prompt: 'p', receivedAt: 0 });
  await flush();
  recorder.recordLlmCall({
    iteration: 0,
    model: 'llama3',
    ok: true,
    text: 'x',
    usage: { promptTokens: 100, completionTokens: 10 },
    categoryTokens: { instructionTokens: 10, userRequestTokens: 10, conversationTokens: 10, toolOutputTokens: 10, toolDefinitionTokens: 70 },
    repeatedInput: { repeatedTokens: 70, newTokens: 30 },
  });
  await flush();

  const db = new DatabaseSync(dbPath);
  try {
    const llmCall = db.prepare('SELECT * FROM llm_calls').get() as Record<string, unknown>;
    assert.equal(llmCall.tool_definition_tokens, 70);
    assert.equal(llmCall.attribution_version, 1);
  } finally {
    db.close();
  }
});

test('a call recorded with no category tokens (as if from before attribution existed) is marked under the previous attribution', async () => {
  const dbPath = tmpDbPath();
  const recorder = new SqliteStatsRecorder(dbPath, true);

  recorder.recordMessage({ chatId: 1, prompt: 'p', receivedAt: 0 });
  await flush();
  recorder.recordLlmCall({ iteration: 0, model: 'stub', ok: true, text: 'x', usage: { promptTokens: 100, completionTokens: 10 } });
  await flush();

  const db = new DatabaseSync(dbPath);
  try {
    const llmCall = db.prepare('SELECT * FROM llm_calls').get() as Record<string, unknown>;
    assert.equal(llmCall.tool_definition_tokens, 0);
    assert.equal(llmCall.attribution_version, 0);
  } finally {
    db.close();
  }
});

test('storePrompts=false writes null for prompt_text and reply_text', async () => {
  const dbPath = tmpDbPath();
  const recorder = new SqliteStatsRecorder(dbPath, false);

  recorder.recordMessage({ chatId: 1, prompt: 'secret prompt', receivedAt: 0 });
  await flush();
  recorder.recordMessage({ chatId: 1, reply: 'secret reply', replySentAt: 10, ok: true, iterations: 1 });
  await flush();

  const db = new DatabaseSync(dbPath);
  try {
    const message = db.prepare('SELECT * FROM messages').get() as Record<string, unknown>;
    assert.equal(message.prompt_text, null);
    assert.equal(message.reply_text, null);
  } finally {
    db.close();
  }
});
