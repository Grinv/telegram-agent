import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callLlmIsolated } from '../../src/llm/inference-caller.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => path.join(__dirname, '..', 'fixtures', `${name}.ts`);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('resolves with the runner result on a well-behaved run', async () => {
  const result = await callLlmIsolated('hi', {
    provider: 'stub',
    timeoutMs: 2000,
    runnerPath: fixture('success-runner'),
  });

  assert.deepEqual(result, { ok: true, text: 'fixture success' });
});

test('resolves with PROVIDER_ERROR when the runner reports a failure', async () => {
  const result = await callLlmIsolated('hi', {
    provider: 'stub',
    timeoutMs: 2000,
    runnerPath: fixture('error-runner'),
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'PROVIDER_ERROR');
});

test('kills the child and resolves with TIMEOUT when the runner hangs', async () => {
  let childPid: number | undefined;

  const result = await callLlmIsolated('hi', {
    provider: 'stub',
    timeoutMs: 200,
    runnerPath: fixture('hang-runner'),
    onChildSpawned: (child) => {
      childPid = child.pid;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'TIMEOUT');

  assert.ok(childPid, 'expected the child to have been spawned');
  await delay(50); // give the OS a moment to finish reaping the killed process
  assert.throws(() => process.kill(childPid as number, 0), /ESRCH/);
});

test('resolves with PROVIDER_ERROR when the runner crashes before responding', async () => {
  const result = await callLlmIsolated('hi', {
    provider: 'stub',
    timeoutMs: 2000,
    runnerPath: fixture('crash-runner'),
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'PROVIDER_ERROR');
});
