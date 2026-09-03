import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMessageHandler } from '../src/orchestrator.js';
import { SqliteHistoryStore } from '../src/history/sqlite-store.js';
import { ToolRegistry } from '../src/tools/registry.js';
import type { SandboxExecutor } from '../src/sandbox/sandbox-executor.js';
import type { LlmRequest, LlmResult } from '../src/llm/types.js';
import type { TelegramMessage } from '../src/telegram/client.js';

function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'history-integration-test-'));
  return join(dir, 'history.db');
}

function fakeMessage(text: string, chatId: number): TelegramMessage {
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

function fakeSandboxExecutor(): SandboxExecutor {
  return { async execute() { return []; } } as SandboxExecutor;
}

test('two consecutive messages in the same chat see prior history via a real SqliteHistoryStore', async () => {
  const historyStore = new SqliteHistoryStore(tmpDbPath());
  const requests: LlmRequest[] = [];
  const callLlm = async (request: LlmRequest): Promise<LlmResult> => {
    requests.push(request);
    return { ok: true, text: `reply to: ${request.prompt}` };
  };
  const client = fakeClient();

  const handleMessage = createMessageHandler({
    client,
    provider: 'stub',
    timeoutMs: 1000,
    sandboxExecutor: fakeSandboxExecutor(),
    toolRegistry: new ToolRegistry(),
    historyStore,
    maxIterations: 5,
    callLlm,
  });

  await handleMessage(fakeMessage('first message', 1));
  await handleMessage(fakeMessage('second message', 1));

  assert.equal(requests.length, 2);
  const secondRequestContents = (requests[1].messages ?? []).map((m) => m.content);
  assert.ok(secondRequestContents.some((c) => c.includes('first message')));
  assert.ok(secondRequestContents.some((c) => c.includes('reply to: first message')));
  assert.ok(secondRequestContents.some((c) => c.includes('second message')));
});

test('/new clears a chat\'s history against a real SqliteHistoryStore, and a third chat is unaffected', async () => {
  const historyStore = new SqliteHistoryStore(tmpDbPath());
  const callLlm = async (request: LlmRequest): Promise<LlmResult> => ({ ok: true, text: `reply to: ${request.prompt}` });
  const client = fakeClient();

  const handleMessage = createMessageHandler({
    client,
    provider: 'stub',
    timeoutMs: 1000,
    sandboxExecutor: fakeSandboxExecutor(),
    toolRegistry: new ToolRegistry(),
    historyStore,
    maxIterations: 5,
    callLlm,
  });

  // Chat 1 accumulates history, then resets via /new.
  await handleMessage(fakeMessage('hello', 1));
  assert.equal(historyStore.getHistory(1).length, 2);

  await handleMessage(fakeMessage('/new', 1));
  assert.deepEqual(historyStore.getHistory(1), []);

  // A third, unrelated chat keeps its own history untouched by chat 1's reset.
  await handleMessage(fakeMessage('unrelated chat message', 3));
  assert.equal(historyStore.getHistory(3).length, 2);

  await handleMessage(fakeMessage('/new', 1));
  assert.equal(historyStore.getHistory(3).length, 2, 'chat 3 history must survive chat 1\'s /new');
});
