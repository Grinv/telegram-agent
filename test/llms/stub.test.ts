import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubConnector } from '../../src/llms/stub/index.js';

test('stub connector returns a deterministic placeholder without any network call', async () => {
  const connector = new StubConnector();
  const result = await connector.callLlm('hello there');

  assert.ok(result.ok);
  assert.match(result.text, /hello there/);
});
