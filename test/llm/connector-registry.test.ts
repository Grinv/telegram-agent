import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConnector, ConnectorNotConfiguredError, KNOWN_PROVIDERS } from '../../src/llm/connector-registry.js';
import { StubConnector } from '../../src/llms/stub/index.js';
import { OllamaConnector } from '../../src/llms/ollama/index.js';

test('resolves an instance for each known provider name', () => {
  assert.ok(createConnector('stub') instanceof StubConnector);
  assert.ok(createConnector('ollama') instanceof OllamaConnector);
  assert.deepEqual([...KNOWN_PROVIDERS].sort(), ['ollama', 'stub']);
});

test('throws ConnectorNotConfiguredError for an unrecognized provider name', () => {
  assert.throws(() => createConnector('tinyllama'), ConnectorNotConfiguredError);
});
