import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileTool } from '../../src/tools/write-file.js';
import type { ToolContext, ContainerExecResult } from '../../src/tools/types.js';

function fakeContext(
  result: ContainerExecResult,
): { context: ToolContext; commands: string[]; stdins: (string | undefined)[] } {
  const commands: string[] = [];
  const stdins: (string | undefined)[] = [];
  return {
    commands,
    stdins,
    context: {
      execInContainer: async (command: string, stdin?: string) => {
        commands.push(command);
        stdins.push(stdin);
        return result;
      },
    },
  };
}

test('pipes content via stdin to `cat > <path>` and reports bytes written on success', async () => {
  const { context, commands, stdins } = fakeContext({ stdout: '', stderr: '', exitCode: 0 });

  const result = await writeFileTool.execute(context, { path: '/work/out.txt', content: 'hello' });

  assert.deepEqual(result, { ok: true, output: 'Wrote 5 bytes to /work/out.txt' });
  assert.equal(commands[0], "cat > '/work/out.txt'");
  assert.equal(stdins[0], 'hello');
});

test('returns ok:false with stderr on write failure', async () => {
  const { context } = fakeContext({ stdout: '', stderr: 'Read-only file system', exitCode: 1 });

  const result = await writeFileTool.execute(context, { path: '/etc/passwd', content: 'x' });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'Read-only file system');
});

test('rejects a non-string path argument', async () => {
  const { context } = fakeContext({ stdout: '', stderr: '', exitCode: 0 });

  const result = await writeFileTool.execute(context, { path: 1, content: 'x' });

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /string "path"/);
});

test('rejects a non-string content argument', async () => {
  const { context } = fakeContext({ stdout: '', stderr: '', exitCode: 0 });

  const result = await writeFileTool.execute(context, { path: '/work/out.txt', content: 1 });

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /string "content"/);
});
