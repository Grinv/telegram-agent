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

test('returns ok with stdout on exit code 0 (compression unavailable falls back to raw output)', async () => {
  // A fake that returns exitCode:1 for the rtk pipe call makes compression
  // fail, so this exercises the fallback path and keeps the original
  // assertion meaningful without a compression-aware fake.
  const commands: string[] = [];
  const context = {
    execInContainer: async (command: string) => {
      commands.push(command);
      if (command === 'rtk pipe') return { stdout: '', stderr: 'rtk: not found', exitCode: 127 };
      return { stdout: 'hi\n', stderr: '', exitCode: 0 };
    },
  };

  const result = await executeCommandTool.execute(context, { command: 'echo hi' });

  assert.deepEqual(result, { ok: true, output: 'hi\n', error: undefined });
  assert.equal('compressed' in result, false);
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

test('output is routed through rtk pipe and the result is marked compressed', async () => {
  const seen: Array<{ command: string; stdin?: string }> = [];
  const context = {
    execInContainer: async (command: string, stdin?: string) => {
      seen.push({ command, stdin });
      if (command === 'rtk pipe') return { stdout: 'COMPACT', stderr: '', exitCode: 0 };
      return { stdout: 'verbose\nverbose\nverbose\n', stderr: '', exitCode: 0 };
    },
  };

  const result = await executeCommandTool.execute(context, { command: 'ls -la' });

  assert.equal(result.ok, true);
  assert.equal(result.output, 'COMPACT');
  assert.equal(result.compressed, true);
  assert.deepEqual(seen[1], { command: 'rtk pipe', stdin: 'verbose\nverbose\nverbose\n' }, 'captured output is piped via stdin, not interpolated');
});

test('a compressed failure result is marked compressed too', async () => {
  const context = {
    execInContainer: async (command: string) => {
      if (command === 'rtk pipe') return { stdout: 'COMPACT ERROR', stderr: '', exitCode: 0 };
      return { stdout: '', stderr: 'a very long stack trace...', exitCode: 1 };
    },
  };

  const result = await executeCommandTool.execute(context, { command: 'bad-command' });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'COMPACT ERROR');
  assert.equal(result.compressed, true);
});

test('empty output is not sent through rtk pipe at all', async () => {
  const commands: string[] = [];
  const context = {
    execInContainer: async (command: string) => {
      commands.push(command);
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  };

  const result = await executeCommandTool.execute(context, { command: 'true' });

  assert.deepEqual(result, { ok: true, output: undefined, error: undefined });
  assert.equal(commands.length, 1, 'no rtk pipe call for empty output');
});

test('rejects a non-string command argument', async () => {
  const { context } = fakeContext({ stdout: '', stderr: '', exitCode: 0 });

  const result = await executeCommandTool.execute(context, { command: 42 });

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /string "command"/);
});
