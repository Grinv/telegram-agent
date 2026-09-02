import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listFilesTool } from '../../src/tools/list-files.js';
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

test('returns the directory listing on success', async () => {
  const listing = 'total 8\ndrwxr-xr-x 2 root root 4096 file1.txt\n';
  const { context, commands } = fakeContext({ stdout: listing, stderr: '', exitCode: 0 });

  const result = await listFilesTool.execute(context, { path: '/work' });

  assert.deepEqual(result, { ok: true, output: listing });
  assert.equal(commands[0], "ls -la '/work'");
});

test('returns ok:false with stderr when the path does not exist', async () => {
  const { context } = fakeContext({ stdout: '', stderr: 'ls: no such file or directory', exitCode: 1 });

  const result = await listFilesTool.execute(context, { path: '/missing' });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'ls: no such file or directory');
});

test('rejects a non-string path argument', async () => {
  const { context } = fakeContext({ stdout: '', stderr: '', exitCode: 0 });

  const result = await listFilesTool.execute(context, { path: true });

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /string "path"/);
});
