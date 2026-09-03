import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSampling } from '../../benchmark/with-sampling.js';
import type { LlmRequest } from '../../src/llm/types.js';

test('withSampling attaches the given sampling controls to every request', async () => {
  const calls: LlmRequest[] = [];
  const raw = async (request: LlmRequest) => {
    calls.push(request);
    return { ok: true as const, text: 'ok' };
  };

  const wrapped = withSampling(raw, { temperature: 0, seed: 42 });
  await wrapped({ prompt: 'hi' }, { provider: 'ollama', timeoutMs: 1000 });

  assert.deepEqual(calls[0].sampling, { temperature: 0, seed: 42 });
});

test('withSampling overrides any sampling controls already on the request', async () => {
  const calls: LlmRequest[] = [];
  const raw = async (request: LlmRequest) => {
    calls.push(request);
    return { ok: true as const, text: 'ok' };
  };

  const wrapped = withSampling(raw, { temperature: 0, seed: 42 });
  await wrapped({ prompt: 'hi', sampling: { temperature: 0.9, seed: 1 } }, { provider: 'ollama', timeoutMs: 1000 });

  assert.deepEqual(calls[0].sampling, { temperature: 0, seed: 42 });
});
