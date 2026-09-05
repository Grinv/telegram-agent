import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultToolRegistry, createSubagentToolRegistry } from '../../src/tools/index.js';
import type { ToolContext } from '../../src/tools/types.js';
import type { LlmRequest, LlmResult } from '../../src/llm/types.js';

test('createDefaultToolRegistry registers all four default tools with correct names', () => {
  const registry = createDefaultToolRegistry();

  const names = registry.getDefinitions().map((def) => def.name).sort();

  assert.deepEqual(names, ['execute_command', 'list_files', 'read_file', 'write_file']);
  assert.equal(registry.isEmpty(), false);
});

function baseContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    execInContainer: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    ...overrides,
  };
}

test('createSubagentToolRegistry registers only the base 4 tools when runLoop/callLlm are absent', () => {
  const registry = createSubagentToolRegistry(baseContext());

  const names = registry.getDefinitions().map((def) => def.name).sort();

  assert.deepEqual(names, ['execute_command', 'list_files', 'read_file', 'write_file']);
});

test('createSubagentToolRegistry registers spawn_subagents (but not spawn_subagent) when runLoop and callLlm are present', () => {
  const fakeCallLlm = async (_req: LlmRequest, _opts: { provider: string; timeoutMs: number }): Promise<LlmResult> => ({
    ok: true,
    text: 'unused',
  });
  const registry = createSubagentToolRegistry(
    baseContext({
      callLlm: fakeCallLlm,
      runLoop: (async () => ({ ok: true, text: 'unused', iterations: 1 })) as ToolContext['runLoop'],
    }),
  );

  const names = registry.getDefinitions().map((def) => def.name).sort();

  assert.deepEqual(names, [
    'execute_command',
    'list_files',
    'read_file',
    'spawn_subagents',
    'write_file',
  ]);
});
