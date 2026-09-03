import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBenchmark } from '../../benchmark/runner.js';
import type { RunnerDeps } from '../../benchmark/runner.js';
import type { BenchmarkTask } from '../../benchmark/types.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { SqliteStatsRecorder } from '../../src/stats/sqlite-recorder.js';
import type { CallLlm, LlmRequest } from '../../src/llm/types.js';
import type { SandboxExecutor, ToolObservation } from '../../src/sandbox/sandbox-executor.js';
import type { Router } from '../../src/routing/types.js';

function emptyRegistry(): ToolRegistry {
  return new ToolRegistry();
}

function registryWithDummyTool(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: 'dummy_tool',
    description: 'A dummy tool for tests',
    parameters: { type: 'object', properties: {} },
    async execute() {
      return { ok: true, output: 'tool output' };
    },
  });
  return registry;
}

function noopSandbox(): SandboxExecutor {
  return { execute: async () => [] };
}

function tmpPath(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return join(dir, 'stats.db');
}

function baseDeps(overrides: Partial<RunnerDeps> = {}): RunnerDeps {
  const statsDbPath = overrides.statsDbPath ?? tmpPath('benchmark-runner-test-');
  const statsRecorder = overrides.statsRecorder ?? new SqliteStatsRecorder(statsDbPath, true, {});
  return {
    tasks: [],
    repetitions: 1,
    model: 'test-model',
    callLlm: async () => ({ ok: true, text: 'ok' }),
    provider: 'stub',
    timeoutMs: 1000,
    sandboxExecutor: noopSandbox(),
    toolRegistry: emptyRegistry(),
    maxIterations: 3,
    ...overrides,
    statsDbPath,
    statsRecorder,
  };
}

/** Waits for a fire-and-forget stats write to flush (see test/stats/sqlite-recorder.test.ts). */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("tasks do not inherit each other's history (task 3.4)", async () => {
  const calls: LlmRequest[] = [];
  const callLlm: CallLlm = async (request) => {
    calls.push(request);
    return { ok: true, text: 'ack' };
  };

  const tasks: BenchmarkTask[] = [
    { id: 'one', kind: 'no-tools', turns: ['TASK_ONE_MESSAGE'], check: () => true },
    { id: 'two', kind: 'no-tools', turns: ['TASK_TWO_MESSAGE'], check: () => true },
  ];

  await runBenchmark(baseDeps({ tasks, callLlm }));

  assert.equal(calls.length, 2);
  const task1Wire = JSON.stringify(calls[0].messages);
  const task2Wire = JSON.stringify(calls[1].messages);
  assert.match(task1Wire, /TASK_ONE_MESSAGE/);
  assert.match(task2Wire, /TASK_TWO_MESSAGE/);
  assert.doesNotMatch(task2Wire, /TASK_ONE_MESSAGE/, "task two's request must not contain task one's turn");
});

test('routing does not vary the model, even with a router that would pick a different one (task 3.5)', async () => {
  const calls: LlmRequest[] = [];
  const callLlm: CallLlm = async (request) => {
    calls.push(request);
    return { ok: true, text: 'ok' };
  };
  let routeCalls = 0;
  const router: Router = {
    route: async () => {
      routeCalls++;
      return { model: 'a-different-model', source: 'fallback', classifierModel: 'classifier' };
    },
  };

  const tasks: BenchmarkTask[] = [{ id: 'one', kind: 'no-tools', turns: ['hi'], check: () => true }];

  await runBenchmark(baseDeps({ tasks, callLlm, model: 'pinned-model', router }));

  assert.equal(routeCalls, 0, 'the router must never be consulted during a benchmark run');
  assert.ok(calls.length > 0);
  assert.ok(calls.every((c) => c.model === 'pinned-model'));
});

test('repetitions are executed and every outcome is recorded (task 3.6)', async () => {
  let callCount = 0;
  const callLlm: CallLlm = async () => {
    callCount++;
    return { ok: true, text: `reply-${callCount}` };
  };
  const tasks: BenchmarkTask[] = [
    { id: 'one', kind: 'no-tools', turns: ['hi'], check: (replies) => replies[0].startsWith('reply') },
  ];

  const result = await runBenchmark(baseDeps({ tasks, callLlm, repetitions: 3 }));

  assert.equal(result.executions.length, 3);
  assert.deepEqual(
    result.executions.map((e) => e.repetition),
    [0, 1, 2],
  );
  assert.ok(result.executions.every((e) => e.correct));
});

test('a benchmark run leaves the real usage statistics database untouched (task 3.7)', async () => {
  const realDbPath = tmpPath('benchmark-real-stats-');
  const realRecorder = new SqliteStatsRecorder(realDbPath, true, {});
  realRecorder.recordMessage({ chatId: 999, prompt: 'real user message', receivedAt: Date.now() });
  await flush();
  realRecorder.recordMessage({ chatId: 999, reply: 'real reply', replySentAt: Date.now(), ok: true, iterations: 1 });
  await flush();

  const realDbBefore = new DatabaseSync(realDbPath);
  const before = (realDbBefore.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n;
  realDbBefore.close();
  assert.equal(before, 1);

  const benchmarkDbPath = tmpPath('benchmark-own-stats-');
  const tasks: BenchmarkTask[] = [{ id: 'one', kind: 'no-tools', turns: ['hi'], check: () => true }];
  await runBenchmark(baseDeps({ tasks, statsDbPath: benchmarkDbPath }));

  const realDbAfter = new DatabaseSync(realDbPath);
  const after = (realDbAfter.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n;
  realDbAfter.close();
  assert.equal(after, 1, 'the real usage statistics database must contain no rows from the benchmark run');

  const benchmarkDb = new DatabaseSync(benchmarkDbPath);
  const benchmarkCount = (benchmarkDb.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n;
  benchmarkDb.close();
  assert.ok(benchmarkCount >= 1, "the benchmark's own database should contain the run's rows");
});

test('records tokens and cost per execution, read back from the stats database', async () => {
  const callLlm: CallLlm = async () => ({
    ok: true,
    text: 'final answer',
    usage: { promptTokens: 10, completionTokens: 5 },
  });
  const tasks: BenchmarkTask[] = [{ id: 'one', kind: 'no-tools', turns: ['hi'], check: () => true }];
  const statsDbPath = tmpPath('benchmark-cost-test-');
  const statsRecorder = new SqliteStatsRecorder(statsDbPath, true, {
    'test-model': { inputPerMillion: 1_000_000, outputPerMillion: 2_000_000 },
  });

  const result = await runBenchmark(baseDeps({ tasks, callLlm, statsDbPath, statsRecorder }));

  assert.equal(result.executions.length, 1);
  const [execution] = result.executions;
  assert.equal(execution.inputTokens, 10);
  assert.equal(execution.outputTokens, 5);
  assert.equal(execution.turns, 1);
  assert.equal(execution.toolCalls, 0);
  assert.equal(execution.estimatedCost, 10 * 1 + 5 * 2);
});

test('records turns and tool calls across a multi-iteration tool-using answer', async () => {
  let iteration = 0;
  const callLlm: CallLlm = async () => {
    iteration++;
    if (iteration === 1) {
      return { ok: true, text: '', toolCalls: [{ name: 'dummy_tool', arguments: {} }] };
    }
    return { ok: true, text: 'final answer' };
  };
  const sandboxExecutor: SandboxExecutor = {
    execute: async (): Promise<ToolObservation[]> => [{ name: 'dummy_tool', ok: true, output: 'tool output' }],
  };
  const tasks: BenchmarkTask[] = [{ id: 'one', kind: 'command', turns: ['hi'], check: () => true }];

  const result = await runBenchmark(
    baseDeps({ tasks, callLlm, sandboxExecutor, toolRegistry: registryWithDummyTool() }),
  );

  assert.equal(result.executions.length, 1);
  const [execution] = result.executions;
  assert.equal(execution.turns, 2);
  assert.equal(execution.toolCalls, 1);
});

test('per-execution figures do not leak across executions (each starts counting from zero)', async () => {
  const callLlm: CallLlm = async () => ({ ok: true, text: 'ok', usage: { promptTokens: 7, completionTokens: 3 } });
  const tasks: BenchmarkTask[] = [{ id: 'one', kind: 'no-tools', turns: ['hi'], check: () => true }];

  const result = await runBenchmark(baseDeps({ tasks, callLlm, repetitions: 3 }));

  assert.equal(result.executions.length, 3);
  for (const execution of result.executions) {
    assert.equal(execution.inputTokens, 7);
    assert.equal(execution.outputTokens, 3);
    assert.equal(execution.turns, 1);
  }
});
