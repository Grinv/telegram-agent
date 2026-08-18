import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessageHandler } from '../src/orchestrator.js';
import { logger } from '../src/logger.js';
import type { TelegramMessage } from '../src/telegram/client.js';

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

test('sends the LLM reply back to the originating chat on success', async () => {
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    client,
    provider: 'stub',
    timeoutMs: 1000,
    callLlm: async () => ({ ok: true, text: 'hello back' }),
  });

  await handleMessage(fakeMessage('hi'));

  assert.equal(client.sent.length, 1);
  assert.equal(client.sent[0].chatId, 1);
  assert.equal(client.sent[0].text, 'hello back');
});

test('logs the incoming message text when a message is received', async () => {
  await withLoggedInfoCalls(async (calls) => {
    const client = fakeClient();
    const handleMessage = createMessageHandler({
      client,
      provider: 'stub',
      timeoutMs: 1000,
      callLlm: async () => ({ ok: true, text: 'hello back' }),
    });

    await handleMessage(fakeMessage('what is the capital of France?'));

    const receivedLog = calls.find(([message]) => message === 'Message received');
    assert.ok(receivedLog, 'expected a "Message received" log entry');
    assert.equal((receivedLog![1] as { prompt: string }).prompt, 'what is the capital of France?');
  });
});

test('logs the reply text when inference succeeds', async () => {
  await withLoggedInfoCalls(async (calls) => {
    const client = fakeClient();
    const handleMessage = createMessageHandler({
      client,
      provider: 'stub',
      timeoutMs: 1000,
      callLlm: async () => ({ ok: true, text: 'Paris' }),
    });

    await handleMessage(fakeMessage('what is the capital of France?'));

    const successLog = calls.find(([message]) => message === 'Inference succeeded, sending reply');
    assert.ok(successLog, 'expected an "Inference succeeded, sending reply" log entry');
    assert.equal((successLog![1] as { reply: string }).reply, 'Paris');
  });
});

test('sends a user-facing failure notice when inference fails', async () => {
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    client,
    provider: 'stub',
    timeoutMs: 1000,
    callLlm: async () => ({ ok: false, reason: 'TIMEOUT', message: 'took too long' }),
  });

  await handleMessage(fakeMessage('hi'));

  assert.equal(client.sent.length, 1);
  assert.match(client.sent[0].text, /could not process/i);
});

test('sends a failure notice and does not throw when an unexpected error occurs', async () => {
  const client = fakeClient();
  const handleMessage = createMessageHandler({
    client,
    provider: 'stub',
    timeoutMs: 1000,
    callLlm: async () => {
      throw new Error('boom');
    },
  });

  await assert.doesNotReject(handleMessage(fakeMessage('hi')));
  assert.equal(client.sent.length, 1);
  assert.match(client.sent[0].text, /could not process/i);
});

test('processes consecutive messages independently, with no shared state', async () => {
  const client = fakeClient();
  const prompts: string[] = [];
  const handleMessage = createMessageHandler({
    client,
    provider: 'stub',
    timeoutMs: 1000,
    callLlm: async (prompt) => {
      prompts.push(prompt);
      return { ok: true, text: `echo:${prompt}` };
    },
  });

  await handleMessage(fakeMessage('first'));
  await handleMessage(fakeMessage('second'));

  assert.deepEqual(prompts, ['first', 'second']);
  assert.deepEqual(
    client.sent.map((entry) => entry.text),
    ['echo:first', 'echo:second']
  );
});
