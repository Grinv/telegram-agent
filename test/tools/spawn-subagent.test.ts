import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSubagentTool } from '../../src/tools/spawn-subagent.js';
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

/** Minimal base context with everything spawn_subagent needs, overridable per test. */
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

function fakeRunLoop(result: LoopResult): {
  fn: (messages: ChatMessage[], tools: ToolDefinition[], deps: LoopDeps) => Promise<LoopResult>;
  calls: Array<{ messages: ChatMessage[]; tools: ToolDefinition[]; deps: LoopDeps }>;
} {
  const calls: Array<{ messages: ChatMessage[]; tools: ToolDefinition[]; deps: LoopDeps }> = [];
  return {
    calls,
    fn: async (messages, tools, deps) => {
      calls.push({ messages, tools, deps });
      return result;
    },
  };
}

test('spawn_subagent returns the sub-agent answer on success', async () => {
  const { fn: runLoop, calls } = fakeRunLoop({ ok: true, text: 'sub-agent answer', iterations: 1 });
  const context = baseContext({ runLoop });

  const result = await spawnSubagentTool.execute(context, { task: 'find CSVs' });

  assert.deepEqual(result, { ok: true, output: 'sub-agent answer' });
  assert.equal(calls.length, 1);
  const subRegistryTools = calls[0].tools.map((t) => t.name).sort();
  assert.deepEqual(subRegistryTools, ['read_file']);
});

test('spawn_subagent returns an error result when the loop fails', async () => {
  const { fn: runLoop } = fakeRunLoop({ ok: false, reason: 'MAX_ITERATIONS', iterations: 3 });
  const context = baseContext({ runLoop });

  const result = await spawnSubagentTool.execute(context, { task: 'find CSVs' });

  assert.deepEqual(result, { ok: false, error: 'MAX_ITERATIONS' });
});

test('spawn_subagent errors without throwing when context.runLoop is missing', async () => {
  const context = baseContext({ runLoop: undefined });

  const result = await spawnSubagentTool.execute(context, { task: 'find CSVs' });

  assert.equal(result.ok, false);
  assert.match((result as { ok: false; error: string }).error, /Subagent execution not available/);
});

test('spawn_subagent passes args.model through to runLoop deps, and omits it when absent', async () => {
  const { fn: runLoop, calls } = fakeRunLoop({ ok: true, text: 'ok', iterations: 1 });
  const context = baseContext({ runLoop });

  await spawnSubagentTool.execute(context, { task: 'task with model', model: 'llama3.1:8b' });
  assert.equal(calls[0].deps.model, 'llama3.1:8b');

  await spawnSubagentTool.execute(context, { task: 'task without model' });
  assert.equal('model' in calls[1].deps, false);
});
