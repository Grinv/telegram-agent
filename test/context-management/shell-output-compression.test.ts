import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compressShellOutput } from '../../src/context-management/shell-output-compression.js';
import type { ContainerExecResult } from '../../src/tools/types.js';

test('returns the compressed text on success, piping the input via stdin', async () => {
  const calls: Array<{ command: string; stdin?: string }> = [];
  const execInContainer = async (command: string, stdin?: string): Promise<ContainerExecResult> => {
    calls.push({ command, stdin });
    return { stdout: 'compact', stderr: '', exitCode: 0 };
  };

  const result = await compressShellOutput(execInContainer, 'verbose original text');

  assert.equal(result, 'compact');
  assert.deepEqual(calls, [{ command: 'rtk pipe', stdin: 'verbose original text' }]);
});

test('returns undefined for empty input without calling execInContainer', async () => {
  let called = false;
  const execInContainer = async (): Promise<ContainerExecResult> => {
    called = true;
    return { stdout: '', stderr: '', exitCode: 0 };
  };

  const result = await compressShellOutput(execInContainer, '');

  assert.equal(result, undefined);
  assert.equal(called, false);
});

test('returns undefined when rtk exits non-zero', async () => {
  const execInContainer = async (): Promise<ContainerExecResult> => ({ stdout: '', stderr: 'rtk: command not found', exitCode: 127 });

  const result = await compressShellOutput(execInContainer, 'some text');

  assert.equal(result, undefined);
});

test('returns undefined when execInContainer throws, rather than rejecting', async () => {
  const execInContainer = async (): Promise<ContainerExecResult> => {
    throw new Error('docker exec failed');
  };

  const result = await compressShellOutput(execInContainer, 'some text');

  assert.equal(result, undefined);
});
