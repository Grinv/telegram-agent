import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTextMessage } from '../../src/telegram/poller.js';
import type { TelegramUpdate } from '../../src/telegram/client.js';

test('passes through updates that carry a plain text message', () => {
  const update: TelegramUpdate = {
    update_id: 1,
    message: { message_id: 1, chat: { id: 1 }, text: 'hi' },
  };

  assert.deepEqual(extractTextMessage(update), update.message);
});

test('skips a message update with no text (e.g. a sticker)', () => {
  const update: TelegramUpdate = {
    update_id: 2,
    message: { message_id: 2, chat: { id: 1 } },
  };

  assert.equal(extractTextMessage(update), undefined);
});

test('skips an update with no message at all (e.g. an edited_message)', () => {
  const update: TelegramUpdate = { update_id: 3 };

  assert.equal(extractTextMessage(update), undefined);
});
