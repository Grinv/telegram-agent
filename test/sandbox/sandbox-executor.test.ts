import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DockerSandboxExecutor } from '../../src/sandbox/sandbox-executor.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { DockerExecFn, DockerExecResult } from '../../src/sandbox/docker-cli.js';
import type { Tool } from '../../src/tools/types.js';

const CONFIG = { image: 'telegram-agent-sandbox', timeoutMs: 30000, memoryLimit: '256m', cpuLimit: '0.5' };

/** A scripted fake dockerExec that records every invocation. */
function fakeDockerExec(containerId = 'abc123'): {
  fn: DockerExecFn;
  calls: Array<{ args: string[]; options?: { stdin?: string; timeoutMs?: number } }>;
} {
  const calls: Array<{ args: string[]; options?: { stdin?: string; timeoutMs?: number } }> = [];
  const fn: DockerExecFn = async (args, options) => {
    calls.push({ args, options });
    if (args[0] === 'run') {
      return { stdout: `${containerId}\n`, stderr: '', exitCode: 0 };
    }
    if (args[0] === 'exec') {
      return { stdout: 'tool output', stderr: '', exitCode: 0 };
    }
    if (args[0] === 'stop') {
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  };
  return { fn, calls };
}

function registryWithEchoTool(): ToolRegistry {
  const registry = new ToolRegistry();
  const tool: Tool = {
    name: 'execute_command',
    description: 'Run a command',
    parameters: { type: 'object', properties: { command: { type: 'string' } } },
    async execute(context, args) {
      const exec = await context.execInContainer(String(args.command));
      return { ok: exec.exitCode === 0, output: exec.stdout };
    },
  };
  registry.register(tool);
  return registry;
}

test('createSandbox runs docker run with read-only, no network, memory, and cpu flags', async () => {
  const { fn, calls } = fakeDockerExec();
  const executor = new DockerSandboxExecutor(CONFIG, fn);

  const containerId = await executor.createSandbox();

  assert.equal(containerId, 'abc123');
  const runCall = calls.find((c) => c.args[0] === 'run');
  assert.ok(runCall, 'expected a docker run call');
  const args = runCall!.args;
  assert.ok(args.includes('--read-only'));
  assert.ok(args.includes('--network'));
  assert.ok(args.includes('none'));
  assert.ok(args.includes('--memory'));
  assert.ok(args.includes(CONFIG.memoryLimit));
  assert.ok(args.includes('--cpus'));
  assert.ok(args.includes(CONFIG.cpuLimit));
  assert.ok(args.includes(CONFIG.image));

  await executor.removeSandbox(containerId);
});

test('execute creates a sandbox, runs the tool via docker exec, then tears the sandbox down', async () => {
  const { fn, calls } = fakeDockerExec();
  const executor = new DockerSandboxExecutor(CONFIG, fn);
  const registry = registryWithEchoTool();

  const observations = await executor.execute(
    [{ name: 'execute_command', arguments: { command: 'echo hi' } }],
    registry,
  );

  assert.deepEqual(observations, [{ name: 'execute_command', ok: true, output: 'tool output' }]);

  const kinds = calls.map((c) => c.args[0]);
  assert.deepEqual(kinds, ['run', 'exec', 'stop'], 'expected create → exec → stop in order');

  const execCall = calls.find((c) => c.args[0] === 'exec')!;
  assert.equal(execCall.args[1], 'abc123');
});

test('a tool that throws produces a failure observation instead of rejecting execute()', async () => {
  const { fn, calls } = fakeDockerExec();
  const executor = new DockerSandboxExecutor(CONFIG, fn);
  const registry = new ToolRegistry();
  registry.register({
    name: 'boom',
    description: 'Always throws',
    parameters: { type: 'object', properties: {} },
    async execute() {
      throw new Error('tool exploded');
    },
  });

  const observations = await executor.execute([{ name: 'boom', arguments: {} }], registry);

  assert.deepEqual(observations, [{ name: 'boom', ok: false, error: 'tool exploded' }]);

  const kinds = calls.map((c) => c.args[0]);
  assert.deepEqual(kinds, ['run', 'stop'], 'sandbox must still be torn down after the throw');
});

test('a call to an unregistered tool name returns a failure observation naming it', async () => {
  const { fn, calls } = fakeDockerExec();
  const executor = new DockerSandboxExecutor(CONFIG, fn);
  const registry = new ToolRegistry();

  const observations = await executor.execute(
    [{ name: 'nonexistent_tool', arguments: {} }],
    registry,
  );

  assert.equal(observations.length, 1);
  assert.equal(observations[0].name, 'nonexistent_tool');
  assert.equal(observations[0].ok, false);
  assert.match(observations[0].error ?? '', /nonexistent_tool/);

  const kinds = calls.map((c) => c.args[0]);
  assert.deepEqual(kinds, ['run', 'stop'], 'sandbox is still torn down even though no tool ran');
});

test('an unregistered tool call does not prevent sibling tool calls in the same batch from executing', async () => {
  const { fn } = fakeDockerExec();
  const executor = new DockerSandboxExecutor(CONFIG, fn);
  const registry = registryWithEchoTool();

  const observations = await executor.execute(
    [
      { name: 'nonexistent_tool', arguments: {} },
      { name: 'execute_command', arguments: { command: 'echo hi' } },
    ],
    registry,
  );

  assert.equal(observations.length, 2);
  assert.equal(observations[0].ok, false);
  assert.match(observations[0].error ?? '', /nonexistent_tool/);
  assert.deepEqual(observations[1], { name: 'execute_command', ok: true, output: 'tool output' });
});

test('auto-kill timer stops the container if it outlives the configured timeout', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { fn, calls } = fakeDockerExec();
    const executor = new DockerSandboxExecutor({ ...CONFIG, timeoutMs: 1000 }, fn);

    const containerId = await executor.createSandbox();
    assert.equal(calls.filter((c) => c.args[0] === 'stop').length, 0, 'not stopped yet');

    mock.timers.tick(1000);
    // Let the pending stop-call microtask/promise settle.
    await Promise.resolve();
    await Promise.resolve();

    const stopCalls = calls.filter((c) => c.args[0] === 'stop' && c.args[3] === containerId);
    assert.equal(stopCalls.length, 1, 'auto-kill timer should have called docker stop');
  } finally {
    mock.timers.reset();
  }
});

test('removeSandbox clears the auto-kill timer so it does not fire later', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { fn, calls } = fakeDockerExec();
    const executor = new DockerSandboxExecutor({ ...CONFIG, timeoutMs: 1000 }, fn);

    const containerId = await executor.createSandbox();
    await executor.removeSandbox(containerId);

    const stopCallsBeforeTick = calls.filter((c) => c.args[0] === 'stop').length;
    assert.equal(stopCallsBeforeTick, 1, 'removeSandbox itself calls stop once');

    mock.timers.tick(1000);
    await Promise.resolve();

    const stopCallsAfterTick = calls.filter((c) => c.args[0] === 'stop').length;
    assert.equal(stopCallsAfterTick, 1, 'auto-kill timer must not fire a second stop after removeSandbox');
  } finally {
    mock.timers.reset();
  }
});
