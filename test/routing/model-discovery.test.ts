import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverModels } from '../../src/routing/model-discovery.js';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** A fetch fake keyed by path (`/api/tags` vs `/api/show`), scripted per-model for `/api/show`. */
function fakeOllamaFetch(opts: {
  tags: unknown;
  tagsStatus?: number;
  show: Record<string, unknown>;
}): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = String(url);
    if (urlStr.endsWith('/api/tags')) {
      return jsonResponse(opts.tagsStatus ?? 200, opts.tags);
    }
    if (urlStr.endsWith('/api/show')) {
      const body = JSON.parse(init!.body as string) as { name: string };
      const showBody = opts.show[body.name];
      if (showBody === undefined) {
        return jsonResponse(404, { error: 'not found' });
      }
      return jsonResponse(200, showBody);
    }
    throw new Error(`unexpected URL: ${urlStr}`);
  }) as typeof fetch;
}

test('discoverModels returns ModelEntry[] with correct names, sizes, and tool support', async () => {
  const fetchImpl = fakeOllamaFetch({
    tags: { models: [{ name: 'qwen2.5:0.5b' }, { name: 'llama3.1:8b' }, { name: 'mistral-nemo' }] },
    show: {
      'qwen2.5:0.5b': { capabilities: ['completion'], details: { family: 'qwen2', parameter_size: '0.5B' } },
      'llama3.1:8b': { capabilities: ['completion', 'tools'], details: { family: 'llama', parameter_size: '8B' } },
      'mistral-nemo': { details: { family: 'mistral', parameter_size: '12B' } },
    },
  });

  const models = await discoverModels('http://ollama:11434', fetchImpl);

  assert.deepEqual(models, [
    { name: 'qwen2.5:0.5b', parameterSize: 0.5, family: 'qwen2', supportsTools: false },
    { name: 'llama3.1:8b', parameterSize: 8, family: 'llama', supportsTools: true },
    { name: 'mistral-nemo', parameterSize: 12, family: 'mistral', supportsTools: false },
  ]);
});

test('discoverModels returns an empty array when /api/tags fetch throws a network error', async () => {
  const fetchImpl = (async () => {
    throw new Error('network unreachable');
  }) as typeof fetch;

  const models = await discoverModels('http://ollama:11434', fetchImpl);

  assert.deepEqual(models, []);
});

test('discoverModels returns an empty array when /api/tags responds with a non-OK HTTP status', async () => {
  const fetchImpl = (async () => jsonResponse(500, { error: 'boom' })) as typeof fetch;

  const models = await discoverModels('http://ollama:11434', fetchImpl);

  assert.deepEqual(models, []);
});

test('discoverModels returns an empty array when /api/tags returns malformed JSON', async () => {
  const fetchImpl = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    }) as Response) as typeof fetch;

  const models = await discoverModels('http://ollama:11434', fetchImpl);

  assert.deepEqual(models, []);
});

test('discoverModels normalizes parameter_size across unit suffixes (M vs B) so magnitudes stay comparable', async () => {
  const fetchImpl = fakeOllamaFetch({
    tags: { models: [{ name: 'qwen3.5:0.8b' }, { name: 'llama3.1:8b' }] },
    show: {
      'qwen3.5:0.8b': { capabilities: [], details: { family: 'qwen35', parameter_size: '873.44M' } },
      'llama3.1:8b': { capabilities: [], details: { family: 'llama', parameter_size: '8B' } },
    },
  });

  const models = await discoverModels('http://ollama:11434', fetchImpl);

  const bySize = [...models].sort((a, b) => a.parameterSize - b.parameterSize);
  assert.deepEqual(bySize.map((m) => m.name), ['qwen3.5:0.8b', 'llama3.1:8b'], 'an 873M model must sort below an 8B model');
  assert.ok(Math.abs(models[0].parameterSize - 0.87344) < 1e-6);
});

test('discoverModels defaults parameterSize to 0 for a malformed parameter_size string', async () => {
  const fetchImpl = fakeOllamaFetch({
    tags: { models: [{ name: 'mystery-model' }] },
    show: {
      'mystery-model': { capabilities: [], details: { family: 'mystery', parameter_size: 'unknown' } },
    },
  });

  const models = await discoverModels('http://ollama:11434', fetchImpl);

  assert.deepEqual(models, [{ name: 'mystery-model', parameterSize: 0, family: 'mystery', supportsTools: false }]);
});
