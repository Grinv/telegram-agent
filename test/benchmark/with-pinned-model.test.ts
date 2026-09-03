import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPinnedModel } from '../../benchmark/with-pinned-model.js';
import type { LlmRequest } from '../../src/llm/types.js';

test('withPinnedModel fills in the model when a request omits one', async () => {
  const calls: LlmRequest[] = [];
  const raw = async (request: LlmRequest) => {
    calls.push(request);
    return { ok: true as const, text: 'ok' };
  };

  const wrapped = withPinnedModel(raw, 'pinned-model');
  await wrapped({ prompt: 'hi' }, { provider: 'ollama', timeoutMs: 1000 });

  assert.equal(calls[0].model, 'pinned-model');
});

test('withPinnedModel leaves an explicitly-specified model untouched', async () => {
  const calls: LlmRequest[] = [];
  const raw = async (request: LlmRequest) => {
    calls.push(request);
    return { ok: true as const, text: 'ok' };
  };

  const wrapped = withPinnedModel(raw, 'pinned-model');
  await wrapped({ prompt: 'hi', model: 'explicit-model' }, { provider: 'ollama', timeoutMs: 1000 });

  assert.equal(calls[0].model, 'explicit-model');
});
