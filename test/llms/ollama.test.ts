import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OllamaConnector } from '../../src/llms/ollama/index.js';
import type { ChatMessage } from '../../src/llm/types.js';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** Captures the request body sent to fetchImpl for assertions. */
function capturingFetch(response: Response): { fetch: typeof fetch; bodies: unknown[] } {
  const bodies: unknown[] = [];
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.body) {
      bodies.push(JSON.parse(init.body as string));
    }
    return response;
  }) as typeof fetch;
  return { fetch, bodies };
}

test('resolves with the generated text on a successful Ollama /api/chat response', async () => {
  const fakeFetch = (async () =>
    jsonResponse(200, {
      message: { role: 'assistant', content: 'hello from ollama' },
      prompt_eval_count: 10,
      eval_count: 20,
      total_duration: 50_000_000,
    })) as typeof fetch;
  const connector = new OllamaConnector({}, fakeFetch);

  const result = await connector.callLlm({ prompt: 'hi' });

  assert.deepEqual(result, {
    ok: true,
    text: 'hello from ollama',
    usage: { promptTokens: 10, completionTokens: 20, totalDurationMs: 50 },
  });
});

test('resolves with PROVIDER_ERROR on a non-OK HTTP response', async () => {
  const fakeFetch = (async () => jsonResponse(404, { error: "model '' not found" })) as typeof fetch;
  const connector = new OllamaConnector({}, fakeFetch);

  const result = await connector.callLlm({ prompt: 'hi' });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'PROVIDER_ERROR');
  assert.match(!result.ok ? result.message : '', /404/);
});

test('resolves with PROVIDER_ERROR when the response body is missing the "message" field', async () => {
  const fakeFetch = (async () => jsonResponse(200, { unexpected: true })) as typeof fetch;
  const connector = new OllamaConnector({}, fakeFetch);

  const result = await connector.callLlm({ prompt: 'hi' });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'PROVIDER_ERROR');
});

test('resolves with PROVIDER_ERROR instead of throwing when fetch itself fails', async () => {
  const fakeFetch = (async () => {
    throw new Error('network unreachable');
  }) as typeof fetch;
  const connector = new OllamaConnector({}, fakeFetch);

  const result = await connector.callLlm({ prompt: 'hi' });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'PROVIDER_ERROR');
  assert.match(!result.ok ? result.message : '', /network unreachable/);
});

test('parses tool_calls and usage from the /api/chat response', async () => {
  const { fetch: fakeFetch, bodies } = capturingFetch(
    jsonResponse(200, {
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            function: {
              name: 'execute_command',
              arguments: { command: 'echo hello' },
            },
          },
        ],
      },
      prompt_eval_count: 5,
      eval_count: 15,
      total_duration: 10_000_000,
    }),
  );
  const connector = new OllamaConnector({}, fakeFetch);

  const result = await connector.callLlm({
    prompt: 'run echo hello',
    tools: [{ name: 'execute_command', description: 'Run a command', parameters: { type: 'object' } }],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.text, '');
    assert.deepEqual(result.toolCalls, [{ name: 'execute_command', arguments: { command: 'echo hello' } }]);
    assert.deepEqual(result.usage, { promptTokens: 5, completionTokens: 15, totalDurationMs: 10 });
  }

  // Verify tools were passed in the request body
  assert.ok(bodies.length > 0);
  const body = bodies[0] as { tools?: unknown[] };
  assert.ok(body.tools);
  assert.equal(body.tools!.length, 1);
});

test('returns text-only result (with usage) when no tool_calls in the response', async () => {
  const fakeFetch = (async () =>
    jsonResponse(200, {
      message: { role: 'assistant', content: 'just text, no tools' },
      prompt_eval_count: 8,
      eval_count: 3,
    })) as typeof fetch;
  const connector = new OllamaConnector({}, fakeFetch);

  const result = await connector.callLlm({ prompt: 'hello' });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.text, 'just text, no tools');
    assert.equal(result.toolCalls, undefined);
    assert.deepEqual(result.usage, { promptTokens: 8, completionTokens: 3 });
  }
});

test('sends the full message list to /api/chat when conversation history is provided, without duplicating the prompt', async () => {
  const { fetch: fakeFetch, bodies } = capturingFetch(
    jsonResponse(200, { message: { role: 'assistant', content: 'final answer' } }),
  );
  const connector = new OllamaConnector({}, fakeFetch);

  const messages: ChatMessage[] = [
    { role: 'user', content: 'list files' },
    { role: 'assistant', content: 'I will use a tool', tool_calls: [{ name: 'execute_command', arguments: { command: 'ls' } }] },
    { role: 'tool', content: 'file1.txt\nfile2.txt', name: 'execute_command' },
  ];

  await connector.callLlm({ prompt: 'list files', messages });

  const body = bodies[0] as { messages: Array<{ role: string; content?: string }> };
  assert.equal(body.messages.length, 3);
  assert.equal(body.messages[0].role, 'user');
  assert.equal(body.messages[0].content, 'list files');
  assert.equal(body.messages[1].role, 'assistant');
  assert.equal(body.messages[2].role, 'tool');
  assert.equal(body.messages[2].content, 'file1.txt\nfile2.txt');
});

test('does not duplicate the latest user turn when messages ends with it (task 2.1)', async () => {
  const { fetch: fakeFetch, bodies } = capturingFetch(
    jsonResponse(200, { message: { role: 'assistant', content: 'a2' } }),
  );
  const connector = new OllamaConnector({}, fakeFetch);

  const messages: ChatMessage[] = [
    { role: 'user', content: 'q1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'q2' },
  ];

  await connector.callLlm({ prompt: 'q2', messages });

  const body = bodies[0] as { messages: Array<{ role: string; content?: string }> };
  assert.equal(body.messages.length, 3);
  assert.deepEqual(
    body.messages.map((m) => m.content),
    ['q1', 'a1', 'q2'],
  );
  assert.equal(body.messages.filter((m) => m.content === 'q2').length, 1);
  assert.equal(body.messages[2].content, 'q2');
});

test('sends a single user message when prompt is given without messages (task 2.2)', async () => {
  const { fetch: fakeFetch, bodies } = capturingFetch(
    jsonResponse(200, { message: { role: 'assistant', content: 'ok' } }),
  );
  const connector = new OllamaConnector({}, fakeFetch);

  await connector.callLlm({ prompt: 'hello there' });

  const body = bodies[0] as { messages: Array<{ role: string; content?: string }> };
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, 'user');
  assert.equal(body.messages[0].content, 'hello there');
});

test('an empty messages array falls back to the single prompt message (task 2.2)', async () => {
  const { fetch: fakeFetch, bodies } = capturingFetch(
    jsonResponse(200, { message: { role: 'assistant', content: 'ok' } }),
  );
  const connector = new OllamaConnector({}, fakeFetch);

  await connector.callLlm({ prompt: 'hello there', messages: [] });

  const body = bodies[0] as { messages: Array<{ role: string; content?: string }> };
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, 'user');
  assert.equal(body.messages[0].content, 'hello there');
});

test('two tool-role messages with different names are sent with distinguishable tool names (task 2.3)', async () => {
  const { fetch: fakeFetch, bodies } = capturingFetch(
    jsonResponse(200, { message: { role: 'assistant', content: 'final answer' } }),
  );
  const connector = new OllamaConnector({}, fakeFetch);

  const messages: ChatMessage[] = [
    { role: 'user', content: 'weather and time please' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        { name: 'get_weather', arguments: { city: 'Paris' } },
        { name: 'get_time', arguments: { city: 'Paris' } },
      ],
    },
    { role: 'tool', content: 'sunny, 22C', name: 'get_weather' },
    { role: 'tool', content: '14:00', name: 'get_time' },
  ];

  await connector.callLlm({ prompt: 'weather and time please', messages });

  const body = bodies[0] as { messages: Array<{ role: string; content?: string; tool_name?: string }> };
  const toolMessages = body.messages.filter((m) => m.role === 'tool');
  assert.equal(toolMessages.length, 2);
  assert.equal(toolMessages[0].tool_name, 'get_weather');
  assert.equal(toolMessages[0].content, 'sunny, 22C');
  assert.equal(toolMessages[1].tool_name, 'get_time');
  assert.equal(toolMessages[1].content, '14:00');
  assert.notEqual(toolMessages[0].tool_name, toolMessages[1].tool_name);
});

test('tool definitions are wrapped in the OpenAI-compatible function shape Ollama expects (task 2.4)', async () => {
  const { fetch: fakeFetch, bodies } = capturingFetch(
    jsonResponse(200, { message: { role: 'assistant', content: 'ok' } }),
  );
  const connector = new OllamaConnector({}, fakeFetch);

  await connector.callLlm({
    prompt: 'run echo hello',
    tools: [{ name: 'execute_command', description: 'Run a command', parameters: { type: 'object' } }],
  });

  const body = bodies[0] as {
    tools?: Array<{ type: string; function: { name: string; description: string; parameters: unknown } }>;
  };
  assert.ok(body.tools);
  assert.equal(body.tools![0].type, 'function');
  assert.equal(body.tools![0].function.name, 'execute_command');
  assert.equal(body.tools![0].function.description, 'Run a command');
  assert.deepEqual(body.tools![0].function.parameters, { type: 'object' });
  assert.equal((body.tools![0] as unknown as { name?: string }).name, undefined);
});

test('request.model overrides the connector default model in the request body', async () => {
  const { fetch: fakeFetch, bodies } = capturingFetch(
    jsonResponse(200, { message: { role: 'assistant', content: 'ok' } }),
  );
  const connector = new OllamaConnector({ model: 'default-model' }, fakeFetch);

  await connector.callLlm({ prompt: 'hi', model: 'qwen2.5' });

  const body = bodies[0] as { model: string };
  assert.equal(body.model, 'qwen2.5');
});

test('does not include tools in the request body when none are provided', async () => {
  const { fetch: fakeFetch, bodies } = capturingFetch(
    jsonResponse(200, { message: { role: 'assistant', content: 'ok' } }),
  );
  const connector = new OllamaConnector({}, fakeFetch);

  await connector.callLlm({ prompt: 'hi' });

  const body = bodies[0] as { tools?: unknown };
  assert.equal(body.tools, undefined);
});

test('includes think:false in the request body when request.think is false', async () => {
  const { fetch: fakeFetch, bodies } = capturingFetch(
    jsonResponse(200, { message: { role: 'assistant', content: 'ok' } }),
  );
  const connector = new OllamaConnector({}, fakeFetch);

  await connector.callLlm({ prompt: 'hi', think: false });

  const body = bodies[0] as { think?: boolean };
  assert.equal(body.think, false);
});

test('omits think from the request body when request.think is unset', async () => {
  const { fetch: fakeFetch, bodies } = capturingFetch(
    jsonResponse(200, { message: { role: 'assistant', content: 'ok' } }),
  );
  const connector = new OllamaConnector({}, fakeFetch);

  await connector.callLlm({ prompt: 'hi' });

  const body = bodies[0] as { think?: boolean };
  assert.equal('think' in body, false);
});

test('default base URL is http://ollama:11434 (Docker network hostname)', async () => {
  const original = process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_BASE_URL;
  try {
    let capturedUrl = '';
    const spyFetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return jsonResponse(200, { message: { role: 'assistant', content: 'ok' } });
    }) as typeof fetch;
    const connector = new OllamaConnector({}, spyFetch);
    await connector.callLlm({ prompt: 'hi' });
    assert.match(capturedUrl, /http:\/\/ollama:11434\/api\/chat/);
  } finally {
    if (original !== undefined) process.env.OLLAMA_BASE_URL = original;
  }
});
