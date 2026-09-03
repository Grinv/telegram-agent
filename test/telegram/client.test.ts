import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramClient, splitMessageForDelivery, TELEGRAM_MESSAGE_LIMIT } from '../../src/telegram/client.js';

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

test('client hits the configured base URL instead of api.telegram.org', async () => {
  const calls: string[] = [];
  const fakeFetch = (async (url: string) => {
    calls.push(url);
    return jsonResponse({ ok: true, result: [] });
  }) as typeof fetch;

  const client = new TelegramClient('TEST_TOKEN', fakeFetch, 'http://127.0.0.1:8081');
  await client.getUpdates(undefined, 30);

  assert.match(calls[0], /^http:\/\/127\.0\.0\.1:8081\/botTEST_TOKEN\/getUpdates/);
});

test('getUpdates throws when Telegram responds with ok:false', async () => {
  const fakeFetch = (async () => jsonResponse({ ok: false, description: 'bad request' })) as typeof fetch;
  const client = new TelegramClient('TEST_TOKEN', fakeFetch);

  await assert.rejects(client.getUpdates(undefined, 30), /bad request/);
});

// ---------------------------------------------------------------------------
// add-chat-context-history — sender identity parsing
// ---------------------------------------------------------------------------

test('getUpdates parses from.id and from.username into message.from', async () => {
  const fakeFetch = (async () =>
    jsonResponse({
      ok: true,
      result: [
        {
          update_id: 1,
          message: {
            message_id: 1,
            chat: { id: 42 },
            text: 'hi',
            from: { id: 100, username: 'alice', first_name: 'Alice' },
          },
        },
      ],
    })) as typeof fetch;

  const client = new TelegramClient('TEST_TOKEN', fakeFetch);
  const updates = await client.getUpdates(undefined, 30);

  assert.deepEqual(updates[0].message?.from, { id: 100, name: 'alice' });
});

test('getUpdates falls back to first_name when no username is set', async () => {
  const fakeFetch = (async () =>
    jsonResponse({
      ok: true,
      result: [
        {
          update_id: 1,
          message: {
            message_id: 1,
            chat: { id: 42 },
            text: 'hi',
            from: { id: 100, first_name: 'Alice' },
          },
        },
      ],
    })) as typeof fetch;

  const client = new TelegramClient('TEST_TOKEN', fakeFetch);
  const updates = await client.getUpdates(undefined, 30);

  assert.deepEqual(updates[0].message?.from, { id: 100, name: 'Alice' });
});

test('getUpdates does not crash when a message update has no from field', async () => {
  const fakeFetch = (async () =>
    jsonResponse({
      ok: true,
      result: [
        {
          update_id: 1,
          message: { message_id: 1, chat: { id: 42 }, text: 'hi' },
        },
      ],
    })) as typeof fetch;

  const client = new TelegramClient('TEST_TOKEN', fakeFetch);
  const updates = await client.getUpdates(undefined, 30);

  assert.equal(updates[0].message?.from, undefined);
  assert.equal(updates[0].message?.text, 'hi');
});

// ---------------------------------------------------------------------------
// fix-telegram-message-limit — splitMessageForDelivery
// ---------------------------------------------------------------------------

test('splitMessageForDelivery returns the text unchanged when within the limit', () => {
  const text = 'short text';
  assert.deepEqual(splitMessageForDelivery(text, 100), [text]);
});

test('splitMessageForDelivery splits over-long text into parts that reproduce the input exactly', () => {
  const text = 'a'.repeat(250);
  const parts = splitMessageForDelivery(text, 100);

  assert.ok(parts.length >= 3);
  assert.ok(parts.every((part) => part.length <= 100));
  assert.equal(parts.join(''), text);
});

test('splitMessageForDelivery breaks at a line boundary when one is within reach of the limit', () => {
  const text = `${'a'.repeat(90)}\n${'b'.repeat(90)}`;
  const parts = splitMessageForDelivery(text, 100);

  assert.deepEqual(parts, [`${'a'.repeat(90)}\n`, 'b'.repeat(90)]);
});

test('splitMessageForDelivery falls back to a word boundary when there are no line breaks', () => {
  const text = 'word '.repeat(30);
  const parts = splitMessageForDelivery(text, 100);

  assert.ok(parts.length >= 2);
  for (const part of parts.slice(0, -1)) {
    assert.ok(part.endsWith(' '), `expected part to end at a word boundary, got ${JSON.stringify(part)}`);
  }
  assert.equal(parts.join(''), text);
});

test('splitMessageForDelivery never splits a surrogate pair', () => {
  const text = '\u{1F600}'.repeat(60); // 120 UTF-16 code units, no line/word boundaries
  const parts = splitMessageForDelivery(text, 99);

  assert.equal(parts.join(''), text);
  for (const part of parts) {
    assert.ok(part.length <= 99);
    const roundTripped = Buffer.from(part, 'utf8').toString('utf8');
    assert.doesNotMatch(roundTripped, /�/, 'part must not contain a broken surrogate pair');
  }
});

// ---------------------------------------------------------------------------
// fix-telegram-message-limit — sendMessage delivers over-long replies in parts
// ---------------------------------------------------------------------------

test('sendMessage issues one API call per part, in order, and rejects when a part is rejected', async () => {
  const sentTexts: string[] = [];
  let callCount = 0;
  const fakeFetch = (async (_url: string, init?: RequestInit) => {
    callCount++;
    const body = JSON.parse((init?.body as string) ?? '{}') as { text: string };
    sentTexts.push(body.text);
    if (callCount === 2) {
      return { ok: false, status: 400, json: async () => ({ ok: false }) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) } as Response;
  }) as typeof fetch;

  const client = new TelegramClient('TEST_TOKEN', fakeFetch);
  const longText = 'a'.repeat(9000);

  await assert.rejects(client.sendMessage(42, longText));

  assert.equal(sentTexts.length, 2, 'stopped after the rejected part, never attempted the third');
  assert.equal(sentTexts[0].length, TELEGRAM_MESSAGE_LIMIT);
  assert.equal(sentTexts.join(''), longText.slice(0, sentTexts.join('').length));
});
