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
    assert.equal(llmCall.model, 'llama3');
    assert.equal(llmCall.prompt_tokens, 12);
    assert.equal(llmCall.completion_tokens, 4);
    assert.equal(llmCall.latency_ms, 250);
    assert.equal(llmCall.ok, 1);

    const toolCall = db.prepare('SELECT * FROM tool_calls').get() as Record<string, unknown>;
    assert.equal(toolCall.message_id, message.id);
    assert.equal(toolCall.llm_call_id, llmCall.id);
    assert.equal(toolCall.tool_name, 'echo');
    assert.equal(toolCall.args_json, JSON.stringify({ text: 'hi' }));
    assert.equal(toolCall.latency_ms, 30);
    assert.equal(toolCall.ok, 1);
    assert.equal(toolCall.result_len, 'hi'.length);
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
    assert.equal(llmCall.prompt_tokens, 0);
    assert.equal(llmCall.completion_tokens, 0);

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
