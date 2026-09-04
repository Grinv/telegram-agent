import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStatsRecorder } from '../../src/stats/sqlite-recorder.js';
import { CompositeStatsRecorder } from '../../src/stats/composite-recorder.js';
import { createConfiguredStatsRecorder } from '../../src/stats/index.js';

function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stats-otel-test-'));
  return join(dir, 'stats.db');
}

/** Waits for the fire-and-forget write microtask queued by a record* call to flush. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test('with no endpoint configured, no exporter is composed in and local recording is unaffected (covers "No destination configured")', async () => {
  const dbPath = tmpDbPath();
  const { recorder, shutdown } = createConfiguredStatsRecorder({
    dbPath,
    storePrompts: true,
    priceTable: {},
  });

  // Not wrapped in a CompositeStatsRecorder - nothing was composed in, so no
  // OTel SDK was ever constructed and nothing can be exported.
  assert.ok(recorder instanceof SqliteStatsRecorder);
  assert.ok(!(recorder instanceof CompositeStatsRecorder));

  recorder.recordMessage({ chatId: 1, prompt: 'hi', receivedAt: 1000 });
  recorder.recordMessage({ chatId: 1, reply: 'hi', replySentAt: 1100, ok: true, iterations: 0 });
  await flush();

  const db = new DatabaseSync(dbPath);
  const row = db.prepare('SELECT * FROM messages').get() as Record<string, unknown>;
  assert.equal(row.chat_id, 1);
  assert.equal(row.ok, 1);
  db.close();

  await shutdown();
});

test('with an endpoint configured, a handled message\'s trace is sent to it (covers "Operator configures a destination")', async () => {
  const receivedRequests: { url?: string; contentType?: string; bodyLength: number }[] = [];

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      receivedRequests.push({
        url: req.url,
        contentType: req.headers['content-type'],
        bodyLength: Buffer.concat(chunks).length,
      });
      res.writeHead(200);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
  const endpoint = `http://127.0.0.1:${address.port}`;

  try {
    const dbPath = tmpDbPath();
    const { recorder, shutdown } = createConfiguredStatsRecorder({
      dbPath,
      storePrompts: true,
      priceTable: {},
      otelEndpoint: endpoint,
    });

    assert.ok(recorder instanceof CompositeStatsRecorder);

    recorder.recordMessage({ chatId: 1, prompt: 'hi', receivedAt: 1000 });
    recorder.recordLlmCall({
      iteration: 0,
      model: 'llama3',
      ok: true,
      usage: { promptTokens: 10, completionTokens: 5 },
      durationMs: 100,
      calledAt: 1000,
    });
    recorder.recordMessage({ chatId: 1, reply: 'hi', replySentAt: 1100, ok: true, iterations: 1 });

    // shutdown() force-flushes the batch processor before stopping it.
    await shutdown();

    assert.equal(receivedRequests.length, 1, 'expected exactly one export request to the fake collector');
    assert.equal(receivedRequests[0].url, '/v1/traces');
    assert.ok(receivedRequests[0].bodyLength > 0, 'export request body should not be empty');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
