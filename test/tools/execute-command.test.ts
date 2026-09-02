import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeCommandTool } from '../../src/tools/execute-command.js';
import type { ToolContext, ContainerExecResult } from '../../src/tools/types.js';

function fakeContext(result: ContainerExecResult): { context: ToolContext; commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    context: {
      execInContainer: async (command: string) => {
        commands.push(command);
        return result;
      },
    },
  };
}

test('returns ok with stdout on exit code 0', async () => {
  const { context } = fakeContext({ stdout: 'hi\n', stderr: '', exitCode: 0 });

  const result = await executeCommandTool.execute(context, { command: 'echo hi' });

  assert.deepEqual(result, { ok: true, output: 'hi\n', error: undefined });
});

test('returns ok:false with stderr on a non-zero exit code', async () => {
  const { context } = fakeContext({ stdout: '', stderr: 'command not found', exitCode: 1 });

  const result = await executeCommandTool.execute(context, { command: 'bogus' });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'command not found');
});

test('returns ok:false when the command times out (exit code 124 from `timeout`)', async () => {
  const { context } = fakeContext({ stdout: '', stderr: '', exitCode: 124 });

  const result = await executeCommandTool.execute(context, { command: 'sleep 999' });

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /124/);
});

test('rejects a non-string command argument', async () => {
  const { context } = fakeContext({ stdout: '', stderr: '', exitCode: 0 });

  const result = await executeCommandTool.execute(context, { command: 42 });

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /string "command"/);
});
