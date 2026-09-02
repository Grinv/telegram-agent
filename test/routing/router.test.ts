import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../../src/routing/index.js';
import type { CallLlm } from '../../src/routing/classifier.js';
import type { ModelEntry } from '../../src/routing/types.js';
import type { LlmRequest, LlmResult } from '../../src/llm/types.js';

const THREE_MODELS: ModelEntry[] = [
  { name: 'qwen2.5:0.5b', parameterSize: 0.5, family: 'qwen2', supportsTools: false },
  { name: 'llama3.1:8b', parameterSize: 8, family: 'llama', supportsTools: true },
  { name: 'mistral-nemo', parameterSize: 12, family: 'mistral', supportsTools: true },
];

/** A scripted callLlm fake that captures the requests it received. */
function scriptedCallLlm(result: LlmResult): { fn: CallLlm; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  const fn: CallLlm = async (request) => {
    requests.push(request);
    return result;
  };
  return { fn, requests };
}

test('createRouter auto-selects the smallest model as classifier and the largest tool-capable model as fallback', async () => {
  const { fn: callLlm, requests } = scriptedCallLlm({ ok: true, text: 'llama3.1:8b' });
  const router = createRouter({ models: THREE_MODELS, callLlm });

  assert.ok(router, 'router should be created with 3 models');
  await router!.route('hi');

  assert.equal(requests[0].model, 'qwen2.5:0.5b', 'classifier should be the smallest model');
});

test('createRouter falls back to the largest tool-capable model when the classifier is unrecognized', async () => {
  const { fn: callLlm } = scriptedCallLlm({ ok: true, text: 'not-a-real-model' });
  const router = createRouter({ models: THREE_MODELS, callLlm });

  const decision = await router!.route('hi');

  assert.equal(decision.model, 'mistral-nemo', 'fallback should be the largest tool-capable model');
});

test('createRouter falls back to the largest overall model when no model supports tools', async () => {
  const noToolModels: ModelEntry[] = [
    { name: 'small', parameterSize: 1, family: 'x', supportsTools: false },
    { name: 'big', parameterSize: 10, family: 'x', supportsTools: false },
  ];
  const { fn: callLlm } = scriptedCallLlm({ ok: true, text: 'unrecognized' });
  const router = createRouter({ models: noToolModels, callLlm });

  const decision = await router!.route('hi');

  assert.equal(decision.model, 'big');
});

test('createRouter returns null when the models array is empty', () => {
  const { fn: callLlm } = scriptedCallLlm({ ok: true, text: '' });
  const router = createRouter({ models: [], callLlm });

  assert.equal(router, null);
});

test('createRouter returns null when only one model is discovered', () => {
  const { fn: callLlm } = scriptedCallLlm({ ok: true, text: '' });
  const router = createRouter({ models: [THREE_MODELS[0]], callLlm });

  assert.equal(router, null);
});

test('route(): classifier returns a valid model name -> source is "classifier"', async () => {
  const { fn: callLlm } = scriptedCallLlm({ ok: true, text: 'llama3.1:8b' });
  const router = createRouter({ models: THREE_MODELS, callLlm });

  const decision = await router!.route('write a script');

  assert.equal(decision.model, 'llama3.1:8b');
  assert.equal(decision.source, 'classifier');
  assert.equal(decision.classifierModel, 'qwen2.5:0.5b');
});

test('route(): classifier returns an unrecognized name -> source "fallback", reason "unrecognized"', async () => {
  const { fn: callLlm } = scriptedCallLlm({ ok: true, text: 'gpt-4' });
  const router = createRouter({ models: THREE_MODELS, callLlm });

  const decision = await router!.route('hi');

  assert.equal(decision.source, 'fallback');
  assert.equal(decision.reason, 'unrecognized');
  assert.equal(decision.model, 'mistral-nemo');
});

test('route(): classifier call times out -> source "fallback", reason "timeout"', async () => {
  const { fn: callLlm } = scriptedCallLlm({ ok: false, reason: 'TIMEOUT', message: 'took too long' });
  const router = createRouter({ models: THREE_MODELS, callLlm });

  const decision = await router!.route('hi');

  assert.equal(decision.source, 'fallback');
  assert.equal(decision.reason, 'timeout');
});

test('route(): classifier call fails with a provider error -> source "fallback", reason "classifier_error"', async () => {
  const { fn: callLlm } = scriptedCallLlm({ ok: false, reason: 'PROVIDER_ERROR', message: 'ollama unreachable' });
  const router = createRouter({ models: THREE_MODELS, callLlm });

  const decision = await router!.route('hi');

  assert.equal(decision.source, 'fallback');
  assert.equal(decision.reason, 'classifier_error');
});

test('createRouter uses manual classifierModel/fallbackModel overrides instead of auto-selecting', async () => {
  const { fn: callLlm, requests } = scriptedCallLlm({ ok: true, text: 'not-a-real-model' });
  const router = createRouter({
    models: THREE_MODELS,
    callLlm,
    classifierModel: 'mistral-nemo',
    fallbackModel: 'qwen2.5:0.5b',
  });

  const decision = await router!.route('hi');

  assert.equal(requests[0].model, 'mistral-nemo', 'should use the overridden classifier model, not the auto-selected smallest');
  assert.equal(decision.model, 'qwen2.5:0.5b', 'should use the overridden fallback model, not the auto-selected largest');
});
