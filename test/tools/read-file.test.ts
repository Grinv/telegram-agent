import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileTool } from '../../src/tools/read-file.js';
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

test('returns file contents on success', async () => {
  const { context, commands } = fakeContext({ stdout: 'file contents\n', stderr: '', exitCode: 0 });

  const result = await readFileTool.execute(context, { path: '/work/notes.txt' });

  assert.deepEqual(result, { ok: true, output: 'file contents\n' });
  assert.equal(commands[0], "cat '/work/notes.txt'");
});

test('returns ok:false with stderr when the file does not exist', async () => {
  const { context } = fakeContext({ stdout: '', stderr: 'cat: no such file', exitCode: 1 });

  const result = await readFileTool.execute(context, { path: '/work/missing.txt' });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'cat: no such file');
});

test('rejects a non-string path argument', async () => {
  const { context } = fakeContext({ stdout: '', stderr: '', exitCode: 0 });

  const result = await readFileTool.execute(context, { path: 123 });

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /string "path"/);
});
