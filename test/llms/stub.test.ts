import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StubConnector } from '../../src/llms/stub/index.js';
import type { ChatMessage } from '../../src/llm/types.js';

test('stub connector returns a deterministic placeholder without any network call', async () => {
  const connector = new StubConnector();
  const result = await connector.callLlm({ prompt: 'hello there' });

  assert.ok(result.ok);
  if (result.ok) {
    assert.match(result.text, /hello there/);
    assert.equal(result.toolCalls, undefined);
    assert.equal(result.usage, undefined);
  }
});

test('stub connector ignores tools and model, returns text-only result', async () => {
  const connector = new StubConnector();
  const result = await connector.callLlm({
    prompt: 'run a command',
    tools: [{ name: 'execute_command', description: 'Run a command', parameters: { type: 'object' } }],
    model: 'qwen2.5',
  });

  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.toolCalls, undefined);
    assert.equal(result.usage, undefined);
  }
});

test('stub connector returns a successful result when messages include a system message (task 2.5)', async () => {
  const connector = new StubConnector();
  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'hello there' },
  ];

  const result = await connector.callLlm({ prompt: 'hello there', messages });

  assert.ok(result.ok);
});
