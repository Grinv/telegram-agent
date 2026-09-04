import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type Socket } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { BasicTracerProvider, BatchSpanProcessor, type ReadableSpan, type SpanExporter } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { logger } from '../../src/logger.js';
import { SqliteStatsRecorder } from '../../src/stats/sqlite-recorder.js';
import { CompositeStatsRecorder } from '../../src/stats/composite-recorder.js';
import { OtelStatsRecorder } from '../../src/stats/otel-exporter.js';
import { FailureTrackingSpanExporter } from '../../src/stats/otel-failure-tracking-exporter.js';
import { createConfiguredStatsRecorder } from '../../src/stats/index.js';
import type { LlmCallStats, MessageStats, StatsRecorder, ToolCallStats } from '../../src/stats/types.js';

function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stats-otel-failure-test-'));
  return join(dir, 'stats.db');
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** A never-listening local port: bound then immediately released, so a connection to it is refused fast. */
async function unreachablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test('an unreachable export destination still lets local statistics be recorded, with the failure logged (covers "Export destination is unreachable")', async () => {
  const port = await unreachablePort();
  const dbPath = tmpDbPath();

  const sqliteRecorder = new SqliteStatsRecorder(dbPath, true);

  // Assembled from the same building blocks `createOtelExportRecorder` uses,
  // but with a short `timeoutMillis` so the built-in retry/backoff for a
  // connection-refused error gives up in well under a second rather than
  // ~10s - the retry policy itself is standard OTLP-exporter behaviour, not
  // something this change controls, so it's not worth a slow test.
  const otlpExporter = new FailureTrackingSpanExporter(
    new OTLPTraceExporter({ url: `http://127.0.0.1:${port}/v1/traces`, timeoutMillis: 300 })
  );
  const processor = new BatchSpanProcessor(otlpExporter);
  const provider = new BasicTracerProvider({ spanProcessors: [processor] });
  const otelRecorder = new OtelStatsRecorder(provider.getTracer('test'), true, {});

  const recorder = new CompositeStatsRecorder([sqliteRecorder, otelRecorder]);

  const warnMock = mock.method(logger, 'warn');
  try {
    recorder.recordMessage({ chatId: 1, prompt: 'hi', receivedAt: 1000 });
    recorder.recordLlmCall({
      iteration: 0,
      model: 'llama3',
      ok: true,
      usage: { promptTokens: 10, completionTokens: 5 },
      durationMs: 50,
      calledAt: 1000,
    });
    recorder.recordMessage({ chatId: 1, reply: 'hi', replySentAt: 1100, ok: true, iterations: 1 });
    await flush();

    // Local statistics do not wait on the export at all.
    const db = new DatabaseSync(dbPath);
    const row = db.prepare('SELECT * FROM messages').get() as Record<string, unknown>;
    db.close();
    assert.equal(row.chat_id, 1, 'local statistics are still recorded despite the unreachable export destination');

    // Force-flushes the batch processor, which will fail against the
    // unreachable port once the (short) retry budget is spent. The export
    // failure itself is what's under test (via the warn log below); how
    // `provider.shutdown()`'s own promise settles for a connection-refused
    // export is the OTLP exporter's concern, not this wrapper's.
    await provider.shutdown().catch(() => {});

    const loggedUnreachable = warnMock.mock.calls.some((call) =>
      String(call.arguments[0]).includes('trace export destination unreachable')
    );
    assert.ok(loggedUnreachable, 'the export failure should be logged');
  } finally {
    mock.restoreAll();
  }
});

test('an export destination slower than message handling does not delay the reply (covers "Export destination is slow")', async () => {
  const sockets: Socket[] = [];
  const server: Server = createServer(() => {
    // Never responds - holds the connection open.
  });
  server.on('connection', (socket) => sockets.push(socket));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');

  try {
    const dbPath = tmpDbPath();
    const { recorder } = createConfiguredStatsRecorder({
      dbPath,
      storePrompts: true,
      priceTable: {},
      otelEndpoint: `http://127.0.0.1:${address.port}`,
    });

    const startedAt = Date.now();
    recorder.recordMessage({ chatId: 1, prompt: 'hi', receivedAt: 1000 });
    recorder.recordLlmCall({
      iteration: 0,
      model: 'llama3',
      ok: true,
      usage: { promptTokens: 10, completionTokens: 5 },
      durationMs: 50,
      calledAt: 1000,
    });
    recorder.recordMessage({ chatId: 1, reply: 'hi', replySentAt: 1100, ok: true, iterations: 1 });
    const elapsedMs = Date.now() - startedAt;

    // record* is synchronous (StatsRecorder returns void) and the batch
    // processor only queues spans - it never awaits the network from the
    // caller's side, so this must return almost immediately regardless of
    // the (never-responding) destination.
    assert.ok(elapsedMs < 200, `recording should not wait on the slow destination (took ${elapsedMs}ms)`);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('an export destination that stays down across many spans produces one log entry, not one per span (covers "Export destination stays down")', () => {
  const alwaysFails: SpanExporter = {
    export(_spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
      resultCallback({ code: ExportResultCode.FAILED, error: new Error('connection refused') });
    },
    shutdown: () => Promise.resolve(),
  };
  const exporter = new FailureTrackingSpanExporter(alwaysFails);

  const warnMock = mock.method(logger, 'warn');
  try {
    for (let i = 0; i < 50; i++) {
      exporter.export([] as unknown as ReadableSpan[], () => {});
    }
    assert.equal(warnMock.mock.calls.length, 1, 'a destination that stays down should log the transition once, not once per span/batch');
  } finally {
    mock.restoreAll();
  }
});

test('a local database write failure still only warns and lets handling continue, unchanged by the exporter\'s presence (covers "Database write fails")', async () => {
  const dbPath = tmpDbPath();
  const sqliteRecorder = new SqliteStatsRecorder(dbPath, true);

  // Force every subsequent write to fail without touching sqlite-recorder's
  // internals: a second connection holding an exclusive lock makes the
  // recorder's own writes raise "database is locked" (the scenario's own
  // example - see openspec/specs/agent-stats/spec.md).
  const locker = new DatabaseSync(dbPath);
  locker.exec('BEGIN EXCLUSIVE');

  const exporterCalls: { messages: MessageStats[]; llmCalls: LlmCallStats[]; toolCalls: ToolCallStats[] } = {
    messages: [],
    llmCalls: [],
    toolCalls: [],
  };
  const fakeExporter: StatsRecorder = {
    recordMessage: (s) => exporterCalls.messages.push(s),
    recordLlmCall: (s) => exporterCalls.llmCalls.push(s),
    recordToolCall: (s) => exporterCalls.toolCalls.push(s),
  };

  const composite = new CompositeStatsRecorder([sqliteRecorder, fakeExporter]);

  const warnMock = mock.method(logger, 'warn');
  try {
    assert.doesNotThrow(() => {
      composite.recordMessage({ chatId: 1, prompt: 'hi', receivedAt: 1000 });
      composite.recordLlmCall({ iteration: 0, model: 'llama3', ok: true, usage: { promptTokens: 1, completionTokens: 1 }, durationMs: 1 });
      composite.recordMessage({ chatId: 1, reply: 'hi', replySentAt: 1100, ok: true, iterations: 1 });
    });
    await flush();

    const loggedWriteFailure = warnMock.mock.calls.some((call) => String(call.arguments[0]).includes('Stats write failed'));
    assert.ok(loggedWriteFailure, 'the sqlite write failure should be logged as a warning');

    // The other composed recorder is unaffected by the sqlite recorder's failure.
    assert.equal(exporterCalls.messages.length, 2);
    assert.equal(exporterCalls.llmCalls.length, 1);
  } finally {
    mock.restoreAll();
    locker.exec('COMMIT');
    locker.close();
  }
});
