import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDockerExec, ensureNetworkExists } from '../../src/sandbox/docker-cli.js';
import type { ExecFileFn, ExecFileError, DockerExecFn } from '../../src/sandbox/docker-cli.js';

/** A fake `execFile` that resolves with canned stdout/stderr and no error. */
function fakeExecFile(stdout: string, stderr = ''): { fn: ExecFileFn; calls: Array<{ file: string; args: string[] }> } {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fn: ExecFileFn = (file, args, _options, callback) => {
    calls.push({ file, args });
    callback(null, stdout, stderr);
  };
  return { fn, calls };
}

test('resolves with structured stdout/stderr/exitCode 0 on success', async () => {
  const { fn, calls } = fakeExecFile('container-id\n');
  const dockerExec = createDockerExec(fn);

  const result = await dockerExec(['run', '-d', 'alpine']);

  assert.deepEqual(result, { stdout: 'container-id\n', stderr: '', exitCode: 0 });
  assert.equal(calls[0].file, 'docker');
  assert.deepEqual(calls[0].args, ['run', '-d', 'alpine']);
});

test('resolves with the exit code (not a rejection) on a non-zero exit', async () => {
  const fn: ExecFileFn = (_file, _args, _options, callback) => {
    const error = new Error('Command failed') as ExecFileError;
    error.code = 1;
    callback(error, '', 'boom');
  };
  const dockerExec = createDockerExec(fn);

  const result = await dockerExec(['exec', 'id', 'false']);

  assert.deepEqual(result, { stdout: '', stderr: 'boom', exitCode: 1 });
});

test('rejects on a spawn-level failure (no numeric exit code)', async () => {
  const fn: ExecFileFn = (_file, _args, _options, callback) => {
    const error = new Error('spawn docker ENOENT') as ExecFileError;
    callback(error, '', '');
  };
  const dockerExec = createDockerExec(fn);

  await assert.rejects(dockerExec(['run']), /ENOENT/);
});

test('pipes the stdin option into the child process stdin', async () => {
  let written: string | undefined;
  const fn: ExecFileFn = (_file, _args, _options, callback) => {
    callback(null, '', '');
    return {
      stdin: {
        end: (data: string) => {
          written = data;
        },
      },
    } as unknown as ReturnType<ExecFileFn>;
  };
  const dockerExec = createDockerExec(fn);

  await dockerExec(['exec', 'id', 'sh', '-c', 'cat'], { stdin: 'hello' });

  assert.equal(written, 'hello');
});

test('passes signal and timeout through to execFile options', async () => {
  let capturedOptions: { signal?: AbortSignal; timeout?: number } | undefined;
  const fn: ExecFileFn = (_file, _args, options, callback) => {
    capturedOptions = options;
    callback(null, '', '');
  };
  const dockerExec = createDockerExec(fn);
  const controller = new AbortController();

  await dockerExec(['ps'], { signal: controller.signal, timeoutMs: 5000 });

  assert.equal(capturedOptions?.signal, controller.signal);
  assert.equal(capturedOptions?.timeout, 5000);
});

// --- ensureNetworkExists ---

function fakeExecForNetwork(calls: string[][], opts: { inspectExitCode: number; createExitCode?: number; createStderr?: string }): DockerExecFn {
  return async (args) => {
    calls.push(args);
    if (args[0] === 'network' && args[1] === 'inspect') {
      return { stdout: '', stderr: '', exitCode: opts.inspectExitCode };
    }
    if (args[0] === 'network' && args[1] === 'create') {
      return { stdout: '', stderr: opts.createStderr ?? '', exitCode: opts.createExitCode ?? 0 };
    }
    throw new Error(`unexpected docker call: ${args.join(' ')}`);
  };
}

test('ensureNetworkExists does not create the network when it already exists', async () => {
  const calls: string[][] = [];
  const exec = fakeExecForNetwork(calls, { inspectExitCode: 0 });

  await ensureNetworkExists(exec, 'telegram-agent-sandbox-net');

  const kinds = calls.map((c) => c.slice(0, 2).join(' '));
  assert.deepEqual(kinds, ['network inspect']);
});

test('ensureNetworkExists creates the network when it is missing', async () => {
  const calls: string[][] = [];
  const exec = fakeExecForNetwork(calls, { inspectExitCode: 1, createExitCode: 0 });

  await ensureNetworkExists(exec, 'telegram-agent-sandbox-net');

  const kinds = calls.map((c) => c.slice(0, 2).join(' '));
  assert.deepEqual(kinds, ['network inspect', 'network create']);
});

test('ensureNetworkExists resolves (not rejects) when create loses a race to an "already exists" error', async () => {
  const calls: string[][] = [];
  const exec = fakeExecForNetwork(calls, {
    inspectExitCode: 1,
    createExitCode: 1,
    createStderr: 'Error response from daemon: network with name telegram-agent-sandbox-net already exists',
  });

  await assert.doesNotReject(ensureNetworkExists(exec, 'telegram-agent-sandbox-net'));
});

test('ensureNetworkExists rejects when create fails for a reason other than "already exists"', async () => {
  const calls: string[][] = [];
  const exec = fakeExecForNetwork(calls, {
    inspectExitCode: 1,
    createExitCode: 1,
    createStderr: 'permission denied',
  });

  await assert.rejects(ensureNetworkExists(exec, 'telegram-agent-sandbox-net'), /permission denied/);
});
