import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramClient } from '../../src/telegram/client.js';

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

test('getUpdates sends offset and timeout as query params and parses the result', async () => {
  const calls: string[] = [];
  const fakeFetch = (async (url: string) => {
    calls.push(url);
    return jsonResponse({
      ok: true,
      result: [{ update_id: 5, message: { message_id: 1, chat: { id: 42 }, text: 'hi' } }],
    });
  }) as typeof fetch;

  const client = new TelegramClient('TEST_TOKEN', fakeFetch);
  const updates = await client.getUpdates(5, 30);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].update_id, 5);
  assert.match(calls[0], /offset=5/);
  assert.match(calls[0], /timeout=30/);
  assert.match(calls[0], /\/botTEST_TOKEN\/getUpdates/);
});

test('sendMessage posts chat_id and text to the Bot API', async () => {
  let capturedBody: string | undefined;
  const fakeFetch = (async (_url: string, init?: RequestInit) => {
    capturedBody = init?.body as string;
    return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) } as Response;
  }) as typeof fetch;

  const client = new TelegramClient('TEST_TOKEN', fakeFetch);
  await client.sendMessage(42, 'hello');

  assert.deepEqual(JSON.parse(capturedBody ?? '{}'), { chat_id: 42, text: 'hello' });
});

test('getUpdates throws when Telegram responds with ok:false', async () => {
  const fakeFetch = (async () => jsonResponse({ ok: false, description: 'bad request' })) as typeof fetch;
  const client = new TelegramClient('TEST_TOKEN', fakeFetch);

  await assert.rejects(client.getUpdates(undefined, 30), /bad request/);
});
