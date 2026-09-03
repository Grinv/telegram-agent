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
import type { Router, RoutingDecision } from '../src/routing/types.js';
import type { HistoryStore, HistoryTurn } from '../src/history/types.js';

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

/** An in-memory `HistoryStore` fake, keyed by chat id. */
function fakeHistoryStore(): HistoryStore & { turnsByChat: Map<number, HistoryTurn[]> } {
  const turnsByChat = new Map<number, HistoryTurn[]>();
  return {
    turnsByChat,
    getHistory(chatId: number) {
      return turnsByChat.get(chatId) ?? [];
    },
    appendTurn(chatId: number, turn: Omit<HistoryTurn, 'createdAt'>) {
      const list = turnsByChat.get(chatId) ?? [];
      list.push({ ...turn, createdAt: Date.now() });
      turnsByChat.set(chatId, list);
    },
    clearHistory(chatId: number) {
      turnsByChat.delete(chatId);
    },
  };
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
  historyStore: HistoryStore;
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
    historyStore: overrides.historyStore ?? fakeHistoryStore(),
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

// ---------------------------------------------------------------------------
// add-chat-context-history — history-aware message handling
// ---------------------------------------------------------------------------

test('a second message in the same chat produces an LLM request whose messages include the first exchange', async () => {
  const { fn: callLlm, calls } = scriptedCallLlm([
    { ok: true, text: 'first reply' },
    { ok: true, text: 'second reply' },
  ]);
  const client = fakeClient();
  const historyStore = fakeHistoryStore();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, historyStore }),
    client,
  });

  await handleMessage(fakeMessage('first'));
  await handleMessage(fakeMessage('second'));

  assert.equal(calls.length, 2);
  const secondRequestMessages = calls[1].messages ?? [];
  const contents = secondRequestMessages.map((m) => m.content);
  assert.ok(contents.some((c) => c.includes('first')), 'expected the first user turn in the second request');
  assert.ok(contents.includes('first reply'), 'expected the first assistant reply in the second request');
  assert.ok(contents.some((c) => c.includes('second')), 'expected the new user turn in the second request');
});

test('the first message in a new chat is processed with only its own content (empty history)', async () => {
  const { fn: callLlm, calls } = scriptedCallLlm([{ ok: true, text: 'reply' }]);
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm }),
    client,
  });

  await handleMessage(fakeMessage('hi'));

  const userMessages = (calls[0].messages ?? []).filter((m) => m.role === 'user');
  assert.equal(userMessages.length, 1);
  assert.equal(userMessages[0].content, 'hi');
});

test('a message from a sender with an identity is prefixed with their display name in the LLM request', async () => {
  const { fn: callLlm, calls } = scriptedCallLlm([{ ok: true, text: 'reply' }]);
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm }),
    client,
  });

  const message: TelegramMessage = { message_id: 1, chat: { id: 1 }, text: 'hi', from: { id: 100, name: 'Alice' } };
  await handleMessage(message);

  const userMessages = (calls[0].messages ?? []).filter((m) => m.role === 'user');
  assert.equal(userMessages[0].content, 'Alice: hi');
});

test('/new clears the chat history, sends a confirmation, and never calls callLlm or statsRecorder', async () => {
  const llmCalls: LlmRequest[] = [];
  const callLlm: CallLlmFn = async (request) => {
    llmCalls.push(request);
    return { ok: true, text: 'should not be called' };
  };
  const client = fakeClient();
  const historyStore = fakeHistoryStore();
  historyStore.turnsByChat.set(1, [{ role: 'user', content: 'old message', createdAt: Date.now() }]);

  const statsCalls: string[] = [];
  const statsRecorder: StatsRecorder = {
    recordMessage: () => statsCalls.push('recordMessage'),
    recordLlmCall: () => statsCalls.push('recordLlmCall'),
    recordToolCall: () => statsCalls.push('recordToolCall'),
  };

  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, historyStore, statsRecorder }),
    client,
  });

  await handleMessage(fakeMessage('/new'));

  assert.deepEqual(historyStore.getHistory(1), []);
  assert.equal(client.sent.length, 1);
  assert.match(client.sent[0].text, /new conversation/i);
  assert.equal(llmCalls.length, 0, 'callLlm must not be invoked for /new');
  assert.deepEqual(statsCalls, [], 'no stats hooks should fire for /new');
});

test('/new on a chat with no history still replies with a confirmation and makes no LLM call', async () => {
  const { fn: callLlm, calls } = scriptedCallLlm([]);
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm }),
    client,
  });

  await assert.doesNotReject(handleMessage(fakeMessage('/new')));

  assert.equal(client.sent.length, 1);
  assert.equal(calls.length, 0);
});

test('/new on one chat does not affect another chat\'s history', async () => {
  const { fn: callLlm } = scriptedCallLlm([]);
  const client = fakeClient();
  const historyStore = fakeHistoryStore();
  historyStore.turnsByChat.set(2, [{ role: 'user', content: 'chat two message', createdAt: Date.now() }]);
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, historyStore }),
    client,
  });

  await handleMessage(fakeMessage('/new', 1));

  assert.deepEqual(
    historyStore.getHistory(2).map((t) => t.content),
    ['chat two message']
  );
});

test('a successfully delivered exchange persists both the user turn and the assistant reply', async () => {
  const { fn: callLlm } = scriptedCallLlm([{ ok: true, text: 'the answer' }]);
  const client = fakeClient();
  const historyStore = fakeHistoryStore();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, historyStore }),
    client,
  });

  await handleMessage(fakeMessage('hi', 7));

  const turns = historyStore.getHistory(7);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].role, 'user');
  assert.equal(turns[0].content, 'hi');
  assert.equal(turns[1].role, 'assistant');
  assert.equal(turns[1].content, 'the answer');
});

test('a stored user turn is attributed to the sender\'s id and display name', async () => {
  const { fn: callLlm } = scriptedCallLlm([{ ok: true, text: 'reply' }]);
  const client = fakeClient();
  const historyStore = fakeHistoryStore();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, historyStore }),
    client,
  });

  const message: TelegramMessage = { message_id: 1, chat: { id: 3 }, text: 'hi', from: { id: 100, name: 'Alice' } };
  await handleMessage(message);

  const turns = historyStore.getHistory(3);
  assert.equal(turns[0].senderId, 100);
  assert.equal(turns[0].senderName, 'Alice');
});

test('a failed loop appends only the user turn to history, not an assistant turn', async () => {
  const { fn: callLlm } = scriptedCallLlm([{ ok: false, reason: 'TIMEOUT', message: 'took too long' }]);
  const client = fakeClient();
  const historyStore = fakeHistoryStore();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, historyStore }),
    client,
  });

  await handleMessage(fakeMessage('hi', 9));

  const turns = historyStore.getHistory(9);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].role, 'user');
});

test('a delivery failure appends only the user turn to history, not an assistant turn', async () => {
  const { fn: callLlm } = scriptedCallLlm([{ ok: true, text: 'hello back' }]);
  const client = {
    sendMessage: async () => {
      throw new Error('network down');
    },
  };
  const historyStore = fakeHistoryStore();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, historyStore }),
    client,
  });

  await handleMessage(fakeMessage('hi', 11));

  const turns = historyStore.getHistory(11);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].role, 'user');
});

test('intermediate tool-call/observation messages from the loop are not persisted to history', async () => {
  const { fn: callLlm } = scriptedCallLlm([
    { ok: true, text: '', toolCalls: [{ name: 'execute_command', arguments: { command: 'echo hi' } }] },
    { ok: true, text: 'final answer' },
  ]);
  const executor = fakeSandboxExecutor([{ name: 'execute_command', ok: true, output: 'hi' }]);
  const { registry } = registryWithTools();
  const client = fakeClient();
  const historyStore = fakeHistoryStore();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, toolRegistry: registry, sandboxExecutor: executor, historyStore }),
    client,
  });

  await handleMessage(fakeMessage('run echo hi', 13));

  const turns = historyStore.getHistory(13);
  assert.equal(turns.length, 2, 'only the final user turn and final assistant reply are persisted');
  assert.equal(turns[0].role, 'user');
  assert.equal(turns[1].role, 'assistant');
  assert.equal(turns[1].content, 'final answer');
  assert.ok(
    !turns.some((t) => (t as { name?: string }).name === 'execute_command'),
    'no tool-call/observation entries should be persisted'
  );
});

test('the generated system instruction is never persisted to history, and is reassembled on the next message', async () => {
  const { fn: callLlm, calls } = scriptedCallLlm([
    { ok: true, text: 'first reply' },
    { ok: true, text: 'second reply' },
  ]);
  const client = fakeClient();
  const historyStore = fakeHistoryStore();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, historyStore }),
    client,
  });

  await handleMessage(fakeMessage('first', 5));
  await handleMessage(fakeMessage('second', 5));

  const turns = historyStore.getHistory(5);
  assert.ok(
    !turns.some((t) => t.role !== 'user' && t.role !== 'assistant'),
    'only user/assistant turns are stored'
  );

  assert.equal(calls[1].messages?.[0].role, 'system');
  const systemContent = calls[1].messages?.[0].content ?? '';
  assert.ok(systemContent.length > 0);
  assert.ok(
    !turns.some((t) => t.content === systemContent),
    'the system instruction text must not appear as a stored turn'
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

// ---------------------------------------------------------------------------
// fix-telegram-message-limit — finalize stats after delivery
// ---------------------------------------------------------------------------

test('reply that cannot be delivered is recorded as a failure with a delivery-specific reason, never as a success', async () => {
  const { fn: callLlm } = scriptedCallLlm([{ ok: true, text: 'hello back' }]);
  const messages: unknown[] = [];
  const statsRecorder: StatsRecorder = {
    recordMessage: (stats) => messages.push(stats),
    recordLlmCall: () => {},
    recordToolCall: () => {},
  };
  const client = {
    sendMessage: async () => {
      throw new Error('network down');
    },
  };
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, statsRecorder }),
    client,
  });

  await handleMessage(fakeMessage('hi'));

  assert.equal(messages.length, 2, 'recordMessage called on receive and on reply');
  const replyStats = messages[1] as { ok: boolean; reason?: string };
  assert.equal(replyStats.ok, false);
  assert.equal(replyStats.reason, 'DELIVERY_FAILED');
  assert.ok(
    !messages.some((m) => (m as { ok?: boolean }).ok === true),
    'the message must never be recorded as a success'
  );
});

test('on the happy path, the finalizing recordMessage call happens after sendMessage resolves', async () => {
  const { fn: callLlm } = scriptedCallLlm([{ ok: true, text: 'hello back' }]);
  const order: string[] = [];
  const client = {
    sendMessage: async () => {
      order.push('sendMessage');
    },
  };
  const statsRecorder: StatsRecorder = {
    recordMessage: (stats) => {
      if (stats.replySentAt !== undefined) {
        order.push('recordMessage:finalize');
      }
    },
    recordLlmCall: () => {},
    recordToolCall: () => {},
  };
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, statsRecorder }),
    client,
  });

  await handleMessage(fakeMessage('hi'));

  assert.deepEqual(order, ['sendMessage', 'recordMessage:finalize']);
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
// add-agent-skills — system instruction on every request
// ---------------------------------------------------------------------------

test('the first request of a message carries the system instruction ahead of the user turn', async () => {
  const { fn: callLlm, calls } = scriptedCallLlm([{ ok: true, text: 'answer' }]);
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm }),
    client,
  });

  await handleMessage(fakeMessage('hi'));

  assert.equal(calls[0].messages?.[0].role, 'system');
  assert.equal(calls[0].messages?.[1].role, 'user');
});

test('a follow-up request after a tool call also carries the system instruction', async () => {
  const { fn: callLlm, calls } = scriptedCallLlm([
    { ok: true, text: '', toolCalls: [{ name: 'execute_command', arguments: { command: 'echo hi' } }] },
    { ok: true, text: 'done' },
  ]);
  const executor = fakeSandboxExecutor([{ name: 'execute_command', ok: true, output: 'hi' }]);
  const { registry } = registryWithTools();
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, toolRegistry: registry, sandboxExecutor: executor }),
    client,
  });

  await handleMessage(fakeMessage('run echo hi'));

  assert.equal(calls.length, 2);
  assert.equal(calls[1].messages?.[0].role, 'system');
});

test('the reply sent to the chat contains no part of the system instruction', async () => {
  const { fn: callLlm, calls } = scriptedCallLlm([{ ok: true, text: 'the answer' }]);
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm }),
    client,
  });

  await handleMessage(fakeMessage('hi'));

  const systemContent = calls[0].messages?.[0].content ?? '';
  assert.ok(systemContent.length > 0, 'expected a non-empty system instruction to compare against');
  assert.equal(client.sent[0].text, 'the answer');
  assert.ok(!client.sent[0].text.includes(systemContent), 'reply must not contain the system instruction text');
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

test('runLoop passes role: "subagent" through to statsRecorder.recordLlmCall', async () => {
  const { fn: callLlm } = scriptedCallLlm([{ ok: true, text: 'sub answer' }]);
  const executor = fakeSandboxExecutor([]);
  const { registry } = registryWithTools();
  const llmCallStats: Array<{ role?: string }> = [];
  const statsRecorder: StatsRecorder = {
    recordMessage: () => {},
    recordLlmCall: (stats) => llmCallStats.push(stats),
    recordToolCall: () => {},
  };

  await runLoop(
    [{ role: 'user', content: 'sub task' }],
    registry.getDefinitions(),
    {
      callLlm,
      provider: 'stub',
      timeoutMs: 1000,
      sandboxExecutor: executor,
      toolRegistry: registry,
      maxIterations: 3,
      statsRecorder,
      role: 'subagent',
    },
  );

  assert.equal(llmCallStats.length, 1);
  assert.equal(llmCallStats[0].role, 'subagent');
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

// ---------------------------------------------------------------------------
// add-classifier-routing — router integration
// ---------------------------------------------------------------------------

function fakeRouter(decision: RoutingDecision): { router: Router; routedMessages: string[] } {
  const routedMessages: string[] = [];
  return {
    routedMessages,
    router: {
      async route(message: string) {
        routedMessages.push(message);
        return decision;
      },
    },
  };
}

test('when a router is provided, its selected model is passed to runLoop', async () => {
  const { fn: callLlm, calls } = scriptedCallLlm([{ ok: true, text: 'routed answer' }]);
  const { router, routedMessages } = fakeRouter({
    model: 'llama3.1:8b',
    source: 'classifier',
    classifierModel: 'qwen2.5:0.5b',
  });
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm }),
    client,
    router,
  });

  await handleMessage(fakeMessage('hi'));

  assert.deepEqual(routedMessages, ['hi']);
  assert.equal(calls[0].model, 'llama3.1:8b');
  assert.equal(client.sent[0].text, 'routed answer');
});

test('when no router is provided (undefined), behavior is unchanged and no classifier call is made', async () => {
  const { fn: callLlm, calls } = scriptedCallLlm([{ ok: true, text: 'unrouted answer' }]);
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm }),
    client,
  });

  await handleMessage(fakeMessage('hi'));

  assert.equal(calls[0].model, undefined);
  assert.equal(client.sent[0].text, 'unrouted answer');
});

test('router fallback: classifier failure routes to the fallback model and records source="fallback" in stats', async () => {
  const { fn: callLlm, calls } = scriptedCallLlm([{ ok: true, text: 'fallback answer' }]);
  const { router } = fakeRouter({
    model: 'llama3.1:8b',
    source: 'fallback',
    reason: 'timeout',
    classifierModel: 'qwen2.5:0.5b',
  });

  const llmCallStats: unknown[] = [];
  const statsRecorder: StatsRecorder = {
    recordMessage: () => {},
    recordLlmCall: (stats) => llmCallStats.push(stats),
    recordToolCall: () => {},
  };

  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, statsRecorder }),
    client,
    router,
  });

  await handleMessage(fakeMessage('hi'));

  assert.equal(calls[0].model, 'llama3.1:8b');
  assert.equal(client.sent[0].text, 'fallback answer');

  const classifierStat = llmCallStats.find((s) => (s as { role?: string }).role === 'classifier') as
    | { role: string; ok: boolean; model: string }
    | undefined;
  assert.ok(classifierStat, 'expected a recordLlmCall with role="classifier"');
  assert.equal(classifierStat!.ok, false);
  assert.equal(classifierStat!.model, 'qwen2.5:0.5b');
});

test('classifier stats entry records the measured latency of router.route()', async () => {
  const { fn: callLlm } = scriptedCallLlm([{ ok: true, text: 'answer' }]);
  const ROUTE_DELAY_MS = 20;
  const router: Router = {
    async route() {
      await new Promise((resolve) => setTimeout(resolve, ROUTE_DELAY_MS));
      return { model: 'llama3.1:8b', source: 'classifier', classifierModel: 'qwen2.5:0.5b' };
    },
  };

  const llmCallStats: unknown[] = [];
  const statsRecorder: StatsRecorder = {
    recordMessage: () => {},
    recordLlmCall: (stats) => llmCallStats.push(stats),
    recordToolCall: () => {},
  };

  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, statsRecorder }),
    client,
    router,
  });

  await handleMessage(fakeMessage('hi'));

  const classifierStat = llmCallStats.find((s) => (s as { role?: string }).role === 'classifier') as
    | { durationMs?: number }
    | undefined;
  assert.ok(classifierStat, 'expected a recordLlmCall with role="classifier"');
  assert.equal(typeof classifierStat!.durationMs, 'number');
  assert.ok(classifierStat!.durationMs! >= ROUTE_DELAY_MS, `expected durationMs >= ${ROUTE_DELAY_MS}, got ${classifierStat!.durationMs}`);
});

// ---------------------------------------------------------------------------
// fix-empty-llm-response — empty final answer with no tool call is a failure
// ---------------------------------------------------------------------------

test('runLoop classifies an empty text response with no tool calls as EMPTY_RESPONSE, not success', async () => {
  const { fn: callLlm } = scriptedCallLlm([{ ok: true, text: '', toolCalls: undefined }]);
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

  assert.deepEqual(result, { ok: false, reason: 'EMPTY_RESPONSE', iterations: 1 });
});

test('runLoop classifies a whitespace-only text response with no tool calls as EMPTY_RESPONSE', async () => {
  const { fn: callLlm } = scriptedCallLlm([{ ok: true, text: '   \n', toolCalls: undefined }]);
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

  assert.deepEqual(result, { ok: false, reason: 'EMPTY_RESPONSE', iterations: 1 });
});

test('runLoop still returns success for a non-empty text response with no tool calls', async () => {
  const { fn: callLlm } = scriptedCallLlm([{ ok: true, text: 'a real answer', toolCalls: undefined }]);
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

  assert.deepEqual(result, { ok: true, text: 'a real answer', iterations: 1 });
});

test('runLoop does not classify an empty text response as EMPTY_RESPONSE when tool calls are present', async () => {
  const { fn: callLlm } = scriptedCallLlm([
    { ok: true, text: '', toolCalls: [{ name: 'execute_command', arguments: { command: 'echo hi' } }] },
    { ok: true, text: 'final answer' },
  ]);
  const executor = fakeSandboxExecutor([{ name: 'execute_command', ok: true, output: 'hi' }]);
  const { registry } = registryWithTools();

  const result = await runLoop(
    [{ role: 'user', content: 'run echo hi' }],
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

  assert.deepEqual(result, { ok: true, text: 'final answer', iterations: 2 });
  assert.equal(executor.execCount, 1, 'the tool call was executed rather than short-circuited as EMPTY_RESPONSE');
});

test('an empty LLM response with no tool call sends the failure notice, never an empty message', async () => {
  const { fn: callLlm } = scriptedCallLlm([{ ok: true, text: '', toolCalls: undefined }]);
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm }),
    client,
  });

  await handleMessage(fakeMessage('hi'));

  assert.equal(client.sent.length, 1);
  assert.match(client.sent[0].text, /could not process/i);
  assert.ok(
    !client.sent.some((m) => m.text === ''),
    'sendMessage must never be called with an empty text argument'
  );
});

test('an empty LLM response with no tool call is recorded to stats as EMPTY_RESPONSE, not DELIVERY_FAILED', async () => {
  const { fn: callLlm } = scriptedCallLlm([{ ok: true, text: '', toolCalls: undefined }]);
  const messages: unknown[] = [];
  const statsRecorder: StatsRecorder = {
    recordMessage: (stats) => messages.push(stats),
    recordLlmCall: () => {},
    recordToolCall: () => {},
  };
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, statsRecorder }),
    client,
  });

  await handleMessage(fakeMessage('hi'));

  assert.equal(messages.length, 2, 'recordMessage called on receive and on reply');
  const replyStats = messages[1] as { ok: boolean; reason?: string };
  assert.equal(replyStats.ok, false);
  assert.equal(replyStats.reason, 'EMPTY_RESPONSE');
});

test('an empty LLM response with no tool call appends only the user turn to history, not an assistant turn', async () => {
  const { fn: callLlm } = scriptedCallLlm([{ ok: true, text: '', toolCalls: undefined }]);
  const client = fakeClient();
  const historyStore = fakeHistoryStore();
  const handleMessage = createMessageHandler({
    ...defaultOrchestratorDeps({ callLlm, historyStore }),
    client,
  });

  await handleMessage(fakeMessage('hi', 15));

  const turns = historyStore.getHistory(15);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].role, 'user');
});
