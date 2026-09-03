import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSnapshot, writeSnapshot, readSnapshot } from '../../benchmark/snapshot.js';
import type { BenchmarkRunResult } from '../../benchmark/runner.js';

function sampleRunResult(): BenchmarkRunResult {
  return {
    model: 'test-model',
    taskSetId: 'abc123',
    executions: [
      {
        taskId: 'one',
        kind: 'no-tools',
        repetition: 0,
        correct: true,
        inputTokens: 10,
        outputTokens: 5,
        estimatedCost: 0.001,
        turns: 1,
        toolCalls: 0,
        replies: ['Paris'],
      },
      {
        taskId: 'one',
        kind: 'no-tools',
        repetition: 1,
        correct: false,
        inputTokens: 12,
        outputTokens: 6,
        estimatedCost: 0.0012,
        turns: 1,
        toolCalls: 0,
        replies: ['London'],
      },
    ],
  };
}

test('a snapshot contains an entry per execution with all recorded figures (task 4.3)', () => {
  const snapshot = buildSnapshot('my-label', sampleRunResult());

  assert.equal(snapshot.executions.length, 2);
  for (const execution of snapshot.executions) {
    assert.equal(typeof execution.inputTokens, 'number');
    assert.equal(typeof execution.outputTokens, 'number');
    assert.equal(typeof execution.estimatedCost, 'number');
    assert.equal(typeof execution.turns, 'number');
    assert.equal(typeof execution.toolCalls, 'number');
    assert.equal(typeof execution.correct, 'boolean');
  }
});

test('a snapshot states its conditions: model and task set identity (task 4.3)', () => {
  const snapshot = buildSnapshot('my-label', sampleRunResult());

  assert.equal(snapshot.model, 'test-model');
  assert.equal(snapshot.taskSetId, 'abc123');
  assert.equal(snapshot.label, 'my-label');
  assert.equal(typeof snapshot.createdAt, 'string');
});

test('a snapshot written to disk reads back identically', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'benchmark-snapshot-test-'));
  const snapshot = buildSnapshot('round-trip', sampleRunResult());

  const path = await writeSnapshot(snapshot, dir);
  const readBack = await readSnapshot(path);

  assert.deepEqual(readBack, snapshot);
});

test('a label with unsafe filename characters is sanitized', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'benchmark-snapshot-test-'));
  const snapshot = buildSnapshot('before/after optimization: v1', sampleRunResult());

  const path = await writeSnapshot(snapshot, dir);

  assert.ok(path.startsWith(dir));
  assert.doesNotMatch(path, /\/before\/after/);
});
