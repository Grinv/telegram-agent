import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessageHandler, runLoop } from '../src/orchestrator.js';
import { logger } from '../src/logger.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { DockerSandboxExecutor } from '../src/sandbox/sandbox-executor.js';
import type { SandboxExecutor, ToolObservation } from '../src/sandbox/sandbox-executor.js';
import type { DockerExecFn } from '../src/sandbox/docker-cli.js';
import type { StatsRecorder } from '../src/stats/types.js';
import type { LlmRequest, LlmResult, ToolDefinition } from '../src/llm/types.js';
import type { TelegramMessage } from '../src/telegram/client.js';

// ---------------------------------------------------------------------------
// Fakes & helpers
// ---------------------------------------------------------------------------

function fakeMessage(text: string, chatId = 1): TelegramMessage {
  return { message_id: 1, chat: { id: chatId }, text };
}

function fakeClient() {
  const sent: Array<{ chatId: number; text: string }> = [];
  return {
    sent,
    sendMessage: async (chatId: number, text: string) => {
      sent.push({ chatId, text });
    },
  };
}

type CallLlmFn = (request: LlmRequest, options: { provider: string; timeoutMs: number }) => Promise<LlmResult>;

/** A scripted callLlm fake that returns successive results on each call. */
function scriptedCallLlm(results: LlmResult[]): { fn: CallLlmFn; calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  let i = 0;
  const fn: CallLlmFn = async (request) => {
    calls.push(request);
    return results[Math.min(i++, results.length - 1)];
  };
  return { fn, calls };
}

/** A no-op sandbox executor that returns canned observations without touching Docker. */
function fakeSandboxExecutor(observations: ToolObservation[]): SandboxExecutor & { execCount: number } {
  let execCount = 0;
  return {
    execCount: 0 as number,
    async execute() {
      execCount++;
      (this as { execCount: number }).execCount = execCount;
      return observations;
    },
  } as SandboxExecutor & { execCount: number };
}

/** An empty tool registry (one-shot path). */
function emptyRegistry(): ToolRegistry {
  return new ToolRegistry();
}

/** A registry with a dummy tool definition (loop path). */
function registryWithTools(): { registry: ToolRegistry; tools: ToolDefinition[] } {
  const registry = new ToolRegistry();
  // Register a minimal dummy tool so getDefinitions() returns something
  registry.register({
    name: 'execute_command',
    description: 'Run a command',
    parameters: { type: 'object', properties: { command: { type: 'string' } } },
    async execute() {
      return { ok: true, output: 'command output' };
    },
  });
  const tools = registry.getDefinitions();
  return { registry, tools };
}

/** Spies on logger.info for the duration of `run`, then restores it. */
async function withLoggedInfoCalls(run: (calls: Array<[string, unknown]>) => Promise<void>): Promise<void> {
  const calls: Array<[string, unknown]> = [];
  const original = logger.info;
  logger.info = (message: string, detail?: unknown) => calls.push([message, detail]);
  try {
    await run(calls);
  } finally {
    logger.info = original;
  }
}

function defaultOrchestratorDeps(overrides: Partial<{
  callLlm: CallLlmFn;
  toolRegistry: ToolRegistry;
  sandboxExecutor: SandboxExecutor;
  statsRecorder: StatsRecorder;
  maxIterations: number;
}> = {}) {
  return {
    client: fakeClient(),
    provider: 'stub',
    timeoutMs: 1000,
    callLlm: overrides.callLlm ?? (async () => ({ ok: true, text: 'hello back' })),
    toolRegistry: overrides.toolRegistry ?? emptyRegistry(),
    sandboxExecutor: overrides.sandboxExecutor ?? fakeSandboxExecutor([]),
    ...(overrides.statsRecorder ? { statsRecorder: overrides.statsRecorder } : {}),
    maxIterations: overrides.maxIterations ?? 5,
  };
}

// ---------------------------------------------------------------------------
// 10.1 — Existing one-shot tests updated for LlmRequest
// ---------------------------------------------------------------------------

test('sends the LLM reply back to the originating chat on success', async () => {
  const { fn: callLlm } = scriptedCallLlm([{ ok: true, text: 'hello back' }]);
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm }),
    client,
  });

  await handleMessage(fakeMessage('hi'));

  assert.equal(client.sent.length, 1);
  assert.equal(client.sent[0].chatId, 1);
  assert.equal(client.sent[0].text, 'hello back');
});

test('logs the incoming message text when a message is received', async () => {
  await withLoggedInfoCalls(async (calls) => {
    const { fn: callLlm } = scriptedCallLlm([{ ok: true, text: 'hello back' }]);
    const handleMessage = createMessageHandler({
      ...defaultOrchestratorDeps({ callLlm }),
      client: fakeClient(),
    });

    await handleMessage(fakeMessage('what is the capital of France?'));

    const receivedLog = calls.find(([message]) => message === 'Message received');
    assert.ok(receivedLog, 'expected a "Message received" log entry');
    assert.equal((receivedLog![1] as { prompt: string }).prompt, 'what is the capital of France?');
  });
});

test('logs the reply text when inference succeeds', async () => {
  await withLoggedInfoCalls(async (calls) => {
    const { fn: callLlm } = scriptedCallLlm([{ ok: true, text: 'Paris' }]);
    const handleMessage = createMessageHandler({
      ...defaultOrchestratorDeps({ callLlm }),
      client: fakeClient(),
    });

    await handleMessage(fakeMessage('what is the capital of France?'));

    const successLog = calls.find(([message]) => message === 'Inference succeeded, sending reply');
    assert.ok(successLog, 'expected an "Inference succeeded, sending reply" log entry');
    assert.equal((successLog![1] as { reply: string }).reply, 'Paris');
  });
});

test('sends a user-facing failure notice when inference fails', async () => {
  const { fn: callLlm } = scriptedCallLlm([{ ok: false, reason: 'TIMEOUT', message: 'took too long' }]);
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm }),
    client,
  });

  await handleMessage(fakeMessage('hi'));

  assert.equal(client.sent.length, 1);
  assert.match(client.sent[0].text, /could not process/i);
});

test('sends a failure notice and does not throw when an unexpected error occurs', async () => {
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({
      callLlm: async () => {
        throw new Error('boom');
      },
    }),
    client,
  });

  await assert.doesNotReject(handleMessage(fakeMessage('hi')));
  assert.equal(client.sent.length, 1);
  assert.match(client.sent[0].text, /could not process/i);
});

test('processes consecutive messages independently, with no shared state', async () => {
  const prompts: string[] = [];
  const { fn: callLlm } = scriptedCallLlm([]);
  const customCallLlm: CallLlmFn = async (request) => {
    prompts.push(request.prompt);
    return { ok: true, text: `echo:${request.prompt}` };
  };
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm: customCallLlm }),
    client,
  });

  await handleMessage(fakeMessage('first'));
  await handleMessage(fakeMessage('second'));

  assert.deepEqual(prompts, ['first', 'second']);
  assert.deepEqual(
    client.sent.map((entry) => entry.text),
    ['echo:first', 'echo:second']
  );
});

// ---------------------------------------------------------------------------
// 11.5 — Orchestrator loop tests
// ---------------------------------------------------------------------------

test('one-shot path: LLM answers directly without tools (no sandbox spawned)', async () => {
  const { fn: callLlm, calls } = scriptedCallLlm([{ ok: true, text: 'direct answer' }]);
  const executor = fakeSandboxExecutor([]);
  const { registry } = registryWithTools();
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, toolRegistry: registry, sandboxExecutor: executor }),
    client,
  });

  await handleMessage(fakeMessage('hi'));

  assert.equal(client.sent[0].text, 'direct answer');
  assert.equal(calls.length, 1, 'only one LLM call');
  assert.equal(executor.execCount, 0, 'no sandbox spawned');
});

test('loop path: LLM requests a tool → sandbox executes → LLM answers', async () => {
  const { fn: callLlm } = scriptedCallLlm([
    {
      ok: true,
      text: '',
      toolCalls: [{ name: 'execute_command', arguments: { command: 'echo hi' } }],
    },
    { ok: true, text: 'The result is: hi' },
  ]);
  const executor = fakeSandboxExecutor([
    { name: 'execute_command', ok: true, output: 'hi' },
  ]);
  const { registry } = registryWithTools();
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, toolRegistry: registry, sandboxExecutor: executor }),
    client,
  });

  await handleMessage(fakeMessage('run echo hi'));

  assert.equal(client.sent[0].text, 'The result is: hi');
  assert.equal(executor.execCount, 1, 'one sandbox spawned');
});

test('loop path: LLM chains two tool-use iterations → two sandboxes spawned', async () => {
  const { fn: callLlm } = scriptedCallLlm([
    { ok: true, text: '', toolCalls: [{ name: 'execute_command', arguments: { command: 'ls' } }] },
    { ok: true, text: '', toolCalls: [{ name: 'execute_command', arguments: { command: 'cat file' } }] },
    { ok: true, text: 'done' },
  ]);
  const executor = fakeSandboxExecutor([
    { name: 'execute_command', ok: true, output: 'file' },
    { name: 'execute_command', ok: true, output: 'contents' },
  ]);
  const { registry } = registryWithTools();
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, toolRegistry: registry, sandboxExecutor: executor }),
    client,
  });

  await handleMessage(fakeMessage('do stuff'));

  assert.equal(client.sent[0].text, 'done');
  assert.equal(executor.execCount, 2, 'two sandboxes spawned');
});

test('max iterations reached → failure notice sent', async () => {
  const { fn: callLlm } = scriptedCallLlm([
    { ok: true, text: '', toolCalls: [{ name: 'execute_command', arguments: { command: 'loop' } }] },
  ]);
  const executor = fakeSandboxExecutor([
    { name: 'execute_command', ok: true, output: 'still looping' },
  ]);
  const { registry } = registryWithTools();
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, toolRegistry: registry, sandboxExecutor: executor, maxIterations: 2 }),
    client,
  });

  await handleMessage(fakeMessage('loop forever'));

  assert.equal(client.sent.length, 1);
  assert.match(client.sent[0].text, /could not process/i);
});

test('tool execution failure fed back to LLM', async () => {
  const { fn: callLlm } = scriptedCallLlm([
    { ok: true, text: '', toolCalls: [{ name: 'execute_command', arguments: { command: 'bad' } }] },
    { ok: true, text: 'I handled the failure' },
  ]);
  const executor = fakeSandboxExecutor([
    { name: 'execute_command', ok: false, error: 'command not found' },
  ]);
  const { registry } = registryWithTools();
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, toolRegistry: registry, sandboxExecutor: executor }),
    client,
  });

  await handleMessage(fakeMessage('run bad command'));

  assert.equal(client.sent[0].text, 'I handled the failure');
  assert.equal(executor.execCount, 1, 'one sandbox spawned');
});

// ---------------------------------------------------------------------------
// 11.6 — Stats recorder hook points
// ---------------------------------------------------------------------------

test('statsRecorder hooks are called at the right points when provided', async () => {
  const { fn: callLlm } = scriptedCallLlm([
    {
      ok: true,
      text: '',
      toolCalls: [{ name: 'execute_command', arguments: { command: 'echo hi' } }],
      usage: { promptTokens: 5, completionTokens: 3 },
    },
    { ok: true, text: 'final answer', usage: { promptTokens: 10, completionTokens: 2 } },
  ]);
  const executor = fakeSandboxExecutor([
    { name: 'execute_command', ok: true, output: 'hi' },
  ]);
  const { registry } = registryWithTools();

  const messages: unknown[] = [];
  const llmCalls: unknown[] = [];
  const toolCalls: unknown[] = [];

  const statsRecorder: StatsRecorder = {
    recordMessage: (stats) => messages.push(stats),
    recordLlmCall: (stats) => llmCalls.push(stats),
    recordToolCall: (stats) => toolCalls.push(stats),
  };

  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, toolRegistry: registry, sandboxExecutor: executor, statsRecorder }),
    client,
  });

  await handleMessage(fakeMessage('run echo hi'));

  assert.equal(messages.length, 2, 'recordMessage called on receive and on reply');
  assert.equal(llmCalls.length, 2, 'recordLlmCall called for each LLM call');
  assert.equal(toolCalls.length, 1, 'recordToolCall called once for the tool execution');
});

test('statsRecorder receives the reply-sent hook, marked failed, when an unexpected error occurs', async () => {
  const messages: unknown[] = [];
  const statsRecorder: StatsRecorder = {
    recordMessage: (stats) => messages.push(stats),
    recordLlmCall: () => {},
    recordToolCall: () => {},
  };
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({
      callLlm: async () => {
        throw new Error('boom');
      },
      statsRecorder,
    }),
    client,
  });

  await handleMessage(fakeMessage('hi'));

  assert.equal(messages.length, 2, 'recordMessage called on receive and on reply');
  const replyStats = messages[1] as { ok: boolean; reason?: string };
  assert.equal(replyStats.ok, false);
  assert.equal(replyStats.reason, 'UNEXPECTED_ERROR');
});

test('loop works normally (no errors) when statsRecorder is undefined', async () => {
  const { fn: callLlm } = scriptedCallLlm([{ ok: true, text: 'no stats needed' }]);
  const executor = fakeSandboxExecutor([]);
  const { registry } = registryWithTools();
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, toolRegistry: registry, sandboxExecutor: executor }),
    client,
  });

  await handleMessage(fakeMessage('hi'));

  assert.equal(client.sent[0].text, 'no stats needed');
});

// ---------------------------------------------------------------------------
// 11.7 — runLoop callable directly
// ---------------------------------------------------------------------------

test('runLoop is callable directly and returns success for a one-shot answer', async () => {
  const { fn: callLlm } = scriptedCallLlm([{ ok: true, text: 'direct' }]);
  const executor = fakeSandboxExecutor([]);
  const { registry } = registryWithTools();

  const result = await runLoop(
    [{ role: 'user', content: 'hi' }],
    registry.getDefinitions(),
    {
      callLlm,
      provider: 'stub',
      timeoutMs: 1000,
      sandboxExecutor: executor,
      toolRegistry: registry,
      maxIterations: 5,
    },
  );

  assert.deepEqual(result, { ok: true, text: 'direct', iterations: 1 });
});

// ---------------------------------------------------------------------------
// fix-unknown-tool-call-handling — unregistered tool name does not abort the loop
// ---------------------------------------------------------------------------

/** A minimal fake dockerExec, matching test/sandbox/sandbox-executor.test.ts's pattern. */
function fakeDockerExecForOrchestrator(): DockerExecFn {
  return async (args) => {
    if (args[0] === 'run') {
      return { stdout: 'container-id\n', stderr: '', exitCode: 0 };
    }
    if (args[0] === 'exec') {
      return { stdout: 'real tool output', stderr: '', exitCode: 0 };
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  };
}

test('LLM requesting an unregistered tool name does not abort the loop with the generic failure reply', async () => {
  const { fn: callLlm } = scriptedCallLlm([
    {
      ok: true,
      text: '',
      toolCalls: [{ name: 'nonexistent_tool', arguments: {} }],
    },
    { ok: true, text: 'I could not find that tool, here is my best answer anyway' },
  ]);
  const registry = new ToolRegistry();
  registry.register({
    name: 'execute_command',
    description: 'Run a command',
    parameters: { type: 'object', properties: { command: { type: 'string' } } },
    async execute(context, args) {
      const exec = await context.execInContainer(String(args.command));
      return { ok: exec.exitCode === 0, output: exec.stdout };
    },
  });
  const realExecutor = new DockerSandboxExecutor(
    { image: 'telegram-agent-sandbox', timeoutMs: 30000, memoryLimit: '256m', cpuLimit: '0.5' },
    fakeDockerExecForOrchestrator(),
  );
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, toolRegistry: registry, sandboxExecutor: realExecutor }),
    client,
  });

  await handleMessage(fakeMessage('call a made-up tool'));

  assert.equal(client.sent.length, 1);
  assert.equal(client.sent[0].text, 'I could not find that tool, here is my best answer anyway');
  assert.doesNotMatch(client.sent[0].text, /could not process/i);
});

test('runLoop returns failure when max iterations are reached', async () => {
  const { fn: callLlm } = scriptedCallLlm([
    { ok: true, text: '', toolCalls: [{ name: 'execute_command', arguments: { command: 'loop' } }] },
  ]);
  const executor = fakeSandboxExecutor([
    { name: 'execute_command', ok: true, output: 'still going' },
  ]);
  const { registry } = registryWithTools();

  const result = await runLoop(
    [{ role: 'user', content: 'loop' }],
    registry.getDefinitions(),
    {
      callLlm,
      provider: 'stub',
      timeoutMs: 1000,
      sandboxExecutor: executor,
      toolRegistry: registry,
      maxIterations: 3,
    },
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'MAX_ITERATIONS');
    assert.equal(result.iterations, 3);
  }
});
