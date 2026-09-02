import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSubagentsTool } from '../../src/tools/spawn-subagents.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { ToolContext } from '../../src/tools/types.js';
import type { LoopDeps, LoopResult } from '../../src/orchestrator.js';
import type { ChatMessage, LlmRequest, LlmResult, ToolDefinition } from '../../src/llm/types.js';
import type { SandboxExecutor } from '../../src/sandbox/sandbox-executor.js';

function registryWithTools(names: string[]): ToolRegistry {
  const registry = new ToolRegistry();
  for (const name of names) {
    registry.register({
      name,
      description: `Description for ${name}`,
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { ok: true, output: `${name} ran` };
      },
    });
  }
  return registry;
}

function fakeSandboxExecutor(): SandboxExecutor {
  return { async execute() { return []; } };
}

const fakeCallLlm = async (_request: LlmRequest, _options: { provider: string; timeoutMs: number }): Promise<LlmResult> => ({
  ok: true,
  text: 'unused',
});

function baseContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    execInContainer: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    callLlm: fakeCallLlm,
    provider: 'stub',
    timeoutMs: 1000,
    sandboxExecutor: fakeSandboxExecutor(),
    toolRegistry: registryWithTools(['read_file', 'spawn_subagent', 'spawn_subagents']),
    ...overrides,
  };
}

/** A runLoop fake whose calls resolve only when the matching resolver is invoked. Records start order. */
function controllableRunLoop(): {
  fn: (messages: ChatMessage[], tools: ToolDefinition[], deps: LoopDeps) => Promise<LoopResult>;
  starts: number[];
  resolvers: Array<(result: LoopResult) => void>;
} {
  const starts: number[] = [];
  const resolvers: Array<(result: LoopResult) => void> = [];
  let callIndex = 0;
  return {
    starts,
    resolvers,
    fn: (_messages, _tools, _deps) => {
      const idx = callIndex++;
      starts.push(idx);
      return new Promise<LoopResult>((resolve) => {
        resolvers[idx] = resolve;
      });
    },
  };
}

/** A runLoop fake that resolves each call immediately with the next scripted result, in call order. */
function scriptedRunLoop(results: LoopResult[]): (messages: ChatMessage[], tools: ToolDefinition[], deps: LoopDeps) => Promise<LoopResult> {
  let i = 0;
  return async () => results[Math.min(i++, results.length - 1)];
}

test('spawn_subagents runs a batch of tasks concurrently before any resolves', async () => {
  const { fn: runLoop, starts, resolvers } = controllableRunLoop();
  const context = baseContext({ runLoop, maxSubagents: 3 });

  const resultPromise = spawnSubagentsTool.execute(context, { tasks: ['a', 'b', 'c'] });

  // spawnSubagentTool.execute runs synchronously up to the runLoop call, so
  // by the time this line runs, all 3 calls in the batch have started.
  assert.equal(starts.length, 3, 'all 3 runLoop calls should have started before any resolves');

  resolvers.forEach((resolve, i) => resolve({ ok: true, text: `result-${i}`, iterations: 1 }));

  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse((result as { ok: true; output: string }).output), ['result-0', 'result-1', 'result-2']);
});

test('spawn_subagents processes 7 tasks in batches of 3 (no more than 3 in flight at once)', async () => {
  const { fn: runLoop, starts, resolvers } = controllableRunLoop();
  const context = baseContext({ runLoop, maxSubagents: 3 });
  const tasks = Array.from({ length: 7 }, (_, i) => `task-${i}`);

  const resultPromise = spawnSubagentsTool.execute(context, { tasks });

  assert.equal(starts.length, 3, 'first batch: 3 in flight');
  resolvers.slice(0, 3).forEach((resolve, i) => resolve({ ok: true, text: `r${i}`, iterations: 1 }));
  await new Promise((r) => setImmediate(r));

  assert.equal(starts.length, 6, 'second batch starts only after the first batch fully resolves');
  resolvers.slice(3, 6).forEach((resolve, i) => resolve({ ok: true, text: `r${i + 3}`, iterations: 1 }));
  await new Promise((r) => setImmediate(r));

  assert.equal(starts.length, 7, 'third batch (the remaining 1 task) starts after the second batch resolves');
  resolvers[6]({ ok: true, text: 'r6', iterations: 1 });

  const result = await resultPromise;
  assert.equal(result.ok, true);
  const parsed = JSON.parse((result as { ok: true; output: string }).output);
  assert.equal(parsed.length, 7);
});

test('spawn_subagents notes an individual sub-agent failure without failing the whole call', async () => {
  const runLoop = scriptedRunLoop([
    { ok: true, text: 'ok-1', iterations: 1 },
    { ok: false, reason: 'TIMEOUT', iterations: 1 },
    { ok: true, text: 'ok-3', iterations: 1 },
  ]);
  const context = baseContext({ runLoop, maxSubagents: 3 });

  const result = await spawnSubagentsTool.execute(context, { tasks: ['a', 'b', 'c'] });

  assert.equal(result.ok, true);
  const parsed = JSON.parse((result as { ok: true; output: string }).output);
  assert.deepEqual(parsed, ['ok-1', '[failed: TIMEOUT]', 'ok-3']);
});
