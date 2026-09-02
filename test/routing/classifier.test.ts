import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyModel } from '../../src/routing/classifier.js';
import type { ModelEntry } from '../../src/routing/types.js';
import type { CallLlm } from '../../src/routing/classifier.js';
import type { LlmRequest, LlmResult } from '../../src/llm/types.js';

const MODELS: ModelEntry[] = [
  { name: 'qwen2.5:0.5b', parameterSize: 0.5, family: 'qwen2', supportsTools: false },
  { name: 'llama3.1:8b', parameterSize: 8, family: 'llama', supportsTools: true },
];

function fakeCallLlm(result: LlmResult): CallLlm {
  return async () => result;
}

/** A callLlm fake that captures the requests it received, for assertions on what was sent. */
function capturingCallLlm(result: LlmResult): { fn: CallLlm; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  const fn: CallLlm = async (request) => {
    requests.push(request);
    return result;
  };
  return { fn, requests };
}

test('classifyModel returns the matching model name when the classifier responds with a known model', async () => {
  const result = await classifyModel('hi', MODELS, {
    callLlm: fakeCallLlm({ ok: true, text: 'llama3.1:8b' }),
    classifierModel: 'qwen2.5:0.5b',
    timeoutMs: 5000,
  });

  assert.deepEqual(result, { model: 'llama3.1:8b' });
});

test('classifyModel returns model:null when the classifier responds with an unrecognized string', async () => {
  const result = await classifyModel('hi', MODELS, {
    callLlm: fakeCallLlm({ ok: true, text: 'gpt-4' }),
    classifierModel: 'qwen2.5:0.5b',
    timeoutMs: 5000,
  });

  assert.deepEqual(result, { model: null });
});

test('classifyModel returns model:null without throwing when the classifier call fails', async () => {
  const result = await classifyModel('hi', MODELS, {
    callLlm: fakeCallLlm({ ok: false, reason: 'PROVIDER_ERROR', message: 'ollama unreachable' }),
    classifierModel: 'qwen2.5:0.5b',
    timeoutMs: 5000,
  });

  assert.deepEqual(result, { model: null, failureReason: 'PROVIDER_ERROR' });
});

test('classifyModel surfaces failureReason:TIMEOUT when the classifier call times out', async () => {
  const result = await classifyModel('hi', MODELS, {
    callLlm: fakeCallLlm({ ok: false, reason: 'TIMEOUT', message: 'took too long' }),
    classifierModel: 'qwen2.5:0.5b',
    timeoutMs: 5000,
  });

  assert.deepEqual(result, { model: null, failureReason: 'TIMEOUT' });
});

test('classifyModel trims whitespace/newlines before matching', async () => {
  const result = await classifyModel('hi', MODELS, {
    callLlm: fakeCallLlm({ ok: true, text: '\n  llama3.1:8b  \n' }),
    classifierModel: 'qwen2.5:0.5b',
    timeoutMs: 5000,
  });

  assert.deepEqual(result, { model: 'llama3.1:8b' });
});

test('classifyModel includes token usage when the classifier call reports it', async () => {
  const result = await classifyModel('hi', MODELS, {
    callLlm: fakeCallLlm({ ok: true, text: 'llama3.1:8b', usage: { promptTokens: 20, completionTokens: 2 } }),
    classifierModel: 'qwen2.5:0.5b',
    timeoutMs: 5000,
  });

  assert.deepEqual(result, { model: 'llama3.1:8b', usage: { promptTokens: 20, completionTokens: 2 } });
});

test('classifyModel always sets think:false on the request it builds', async () => {
  const { fn: callLlm, requests } = capturingCallLlm({ ok: true, text: 'llama3.1:8b' });

  await classifyModel('hi', MODELS, { callLlm, classifierModel: 'qwen2.5:0.5b', timeoutMs: 5000 });

  assert.equal(requests[0].think, false);
});

test('classifyModel matches a known model name followed by trailing explanatory text', async () => {
  const models: ModelEntry[] = [
    { name: 'qwen2.5:0.5b', parameterSize: 0.5, family: 'qwen2', supportsTools: false },
    { name: 'qwen3.5:0.8b', parameterSize: 0.87, family: 'qwen35', supportsTools: true },
  ];

  const result = await classifyModel('list files', models, {
    callLlm: fakeCallLlm({ ok: true, text: 'qwen3.5:0.8b (0.87B params, supports tools)' }),
    classifierModel: 'qwen2.5:0.5b',
    timeoutMs: 5000,
  });

  assert.equal(result.model, 'qwen3.5:0.8b');
});

test('classifyModel prefers the longest prefix match when one model name is a prefix of another', async () => {
  const models: ModelEntry[] = [
    { name: 'qwen3', parameterSize: 1, family: 'qwen3', supportsTools: false },
    { name: 'qwen3.5:0.8b', parameterSize: 0.87, family: 'qwen35', supportsTools: true },
  ];

  const result = await classifyModel('hi', models, {
    callLlm: fakeCallLlm({ ok: true, text: 'qwen3.5:0.8b is best' }),
    classifierModel: 'qwen3',
    timeoutMs: 5000,
  });

  assert.equal(result.model, 'qwen3.5:0.8b', 'the longer, more specific name should win over the shorter prefix');
});

test('classifyModel still returns model:null when the response does not start with any known model name', async () => {
  const result = await classifyModel('hi', MODELS, {
    callLlm: fakeCallLlm({ ok: true, text: 'gpt-4' }),
    classifierModel: 'qwen2.5:0.5b',
    timeoutMs: 5000,
  });

  assert.deepEqual(result, { model: null });
});
