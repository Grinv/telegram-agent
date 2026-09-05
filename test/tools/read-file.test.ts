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

/** A fake context whose `execInContainer` returns a scripted result per call, in order. */
function fakeContextSequence(results: ContainerExecResult[]): { context: ToolContext; commands: string[] } {
  const commands: string[] = [];
  let i = 0;
  return {
    commands,
    context: {
      execInContainer: async (command: string) => {
        commands.push(command);
        return results[Math.min(i++, results.length - 1)];
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

test('a specified range returns only those lines and states which they are', async () => {
  const { context, commands } = fakeContextSequence([
    { stdout: '10\n', stderr: '', exitCode: 0 }, // wc -l
    { stdout: 'line3\nline4\n', stderr: '', exitCode: 0 }, // sed -n '3,4p'
  ]);

  const result = await readFileTool.execute(context, { path: '/work/file.txt', start_line: 3, end_line: 4 });

  assert.equal(result.ok, true);
  assert.match(result.output ?? '', /Lines 3-4 of 10/);
  assert.match(result.output ?? '', /line3\nline4/);
  assert.match(commands[0], /^wc -l < /);
  assert.match(commands[1], /^sed -n '3,4p' /);
});

test('reading without a range behaves as before (whole file via cat)', async () => {
  const { context, commands } = fakeContext({ stdout: 'whole file\n', stderr: '', exitCode: 0 });

  const result = await readFileTool.execute(context, { path: '/work/file.txt' });

  assert.deepEqual(result, { ok: true, output: 'whole file\n' });
  assert.equal(commands[0], "cat '/work/file.txt'");
});

test('a range starting beyond the end of the file reports an empty range and the file length, rather than failing', async () => {
  const { context } = fakeContextSequence([{ stdout: '5\n', stderr: '', exitCode: 0 }]);

  const result = await readFileTool.execute(context, { path: '/work/file.txt', start_line: 100, end_line: 105 });

  assert.equal(result.ok, true);
  assert.match(result.output ?? '', /empty/i);
  assert.match(result.output ?? '', /5 line/);
});

test('an end_line beyond the file length is clamped to the file length', async () => {
  const { context, commands } = fakeContextSequence([
    { stdout: '10\n', stderr: '', exitCode: 0 },
    { stdout: 'line8\nline9\nline10\n', stderr: '', exitCode: 0 },
  ]);

  const result = await readFileTool.execute(context, { path: '/work/file.txt', start_line: 8, end_line: 50 });

  assert.equal(result.ok, true);
  assert.match(result.output ?? '', /Lines 8-10 of 10/);
  assert.match(commands[1], /^sed -n '8,10p' /);
});

test('rejects start_line without end_line', async () => {
  const { context } = fakeContext({ stdout: '', stderr: '', exitCode: 0 });

  const result = await readFileTool.execute(context, { path: '/work/file.txt', start_line: 1 });

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /start_line.*end_line/);
});

test('rejects an invalid range (end_line before start_line)', async () => {
  const { context } = fakeContext({ stdout: '', stderr: '', exitCode: 0 });

  const result = await readFileTool.execute(context, { path: '/work/file.txt', start_line: 5, end_line: 2 });

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /start_line/);
});
