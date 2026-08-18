import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OllamaConnector } from '../../src/llms/ollama/index.js';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

test('resolves with the generated text on a successful Ollama response', async () => {
  const fakeFetch = (async () => jsonResponse(200, { response: 'hello from ollama' })) as typeof fetch;
  const connector = new OllamaConnector({}, fakeFetch);

  const result = await connector.callLlm('hi');

  assert.deepEqual(result, { ok: true, text: 'hello from ollama' });
});

test('resolves with PROVIDER_ERROR on a non-OK HTTP response', async () => {
  const fakeFetch = (async () => jsonResponse(404, { error: "model '' not found" })) as typeof fetch;
  const connector = new OllamaConnector({}, fakeFetch);

  const result = await connector.callLlm('hi');

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'PROVIDER_ERROR');
  assert.match(!result.ok ? result.message : '', /404/);
});

test('resolves with PROVIDER_ERROR when the response body is missing the "response" field', async () => {
  const fakeFetch = (async () => jsonResponse(200, { unexpected: true })) as typeof fetch;
  const connector = new OllamaConnector({}, fakeFetch);

  const result = await connector.callLlm('hi');

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'PROVIDER_ERROR');
});

test('resolves with PROVIDER_ERROR instead of throwing when fetch itself fails', async () => {
  const fakeFetch = (async () => {
    throw new Error('network unreachable');
  }) as typeof fetch;
  const connector = new OllamaConnector({}, fakeFetch);

  const result = await connector.callLlm('hi');

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'PROVIDER_ERROR');
  assert.match(!result.ok ? result.message : '', /network unreachable/);
});
