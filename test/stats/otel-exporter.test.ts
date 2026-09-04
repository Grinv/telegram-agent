import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor, type ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { OtelStatsRecorder } from '../../src/stats/otel-exporter.js';

function setup(storePrompts = true) {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const tracer = provider.getTracer('test');
  const recorder = new OtelStatsRecorder(tracer, storePrompts, {
    llama3: { inputPerMillion: 1, outputPerMillion: 2 },
  });
  return { exporter, recorder };
}

function byName(spans: ReadableSpan[], name: string): ReadableSpan[] {
  return spans.filter((s) => s.name === name);
}

function childrenOf(spans: ReadableSpan[], parent: ReadableSpan): ReadableSpan[] {
  return spans.filter((s) => s.parentSpanContext?.spanId === parent.spanContext().spanId);
}

test('a message with two LLM calls and a tool call between them produces one message span with three nested child spans', () => {
  const { exporter, recorder } = setup();

  recorder.recordMessage({ chatId: 1, prompt: 'hi', receivedAt: 1000 });
  recorder.recordLlmCall({
    iteration: 0,
    model: 'llama3',
    ok: true,
    text: 'thinking',
    usage: { promptTokens: 10, completionTokens: 5 },
    durationMs: 100,
    calledAt: 1000,
  });
  recorder.recordToolCall({
    iteration: 0,
    toolCalls: [{ name: 'echo', arguments: { text: 'hi' } }],
    results: [{ ok: true, output: 'hi' }],
    durationMs: 30,
  });
  recorder.recordLlmCall({
    iteration: 1,
    model: 'llama3',
    ok: true,
    text: 'done',
    usage: { promptTokens: 20, completionTokens: 8 },
    durationMs: 120,
    calledAt: 1200,
  });
  recorder.recordMessage({ chatId: 1, reply: 'done', replySentAt: 1500, ok: true, iterations: 2 });

  const spans = exporter.getFinishedSpans();
  const messageSpans = byName(spans, 'handle_message');
  assert.equal(messageSpans.length, 1);
  const messageSpan = messageSpans[0];

  const children = childrenOf(spans, messageSpan);
  assert.equal(children.length, 3, 'message span has exactly three children: two llm_call and one tool_call');

  const llmChildren = children.filter((s) => s.name === 'llm_call');
  const toolChildren = children.filter((s) => s.name === 'tool_call');
  assert.equal(llmChildren.length, 2);
  assert.equal(toolChildren.length, 1);

  assert.equal(llmChildren[0].attributes['gen_ai.usage.input_tokens'], 10);
  assert.equal(llmChildren[0].attributes['gen_ai.usage.output_tokens'], 5);
  assert.equal(llmChildren[1].attributes['gen_ai.usage.input_tokens'], 20);
  assert.equal(toolChildren[0].attributes['gen_ai.tool.name'], 'echo');
  assert.equal(toolChildren[0].attributes['telegram_agent.duration_ms'], 30);
});

test('sub-agent LLM-call spans appear beneath the spawning tool call, not as siblings of the message\'s own LLM calls', () => {
  const { exporter, recorder } = setup();

  recorder.recordMessage({ chatId: 1, prompt: 'do it', receivedAt: 1000 });
  recorder.recordLlmCall({
    iteration: 0,
    model: 'llama3',
    ok: true,
    usage: { promptTokens: 10, completionTokens: 5 },
    durationMs: 50,
    calledAt: 1000,
  });

  // Sub-agent LLM calls are recorded *before* the tool call that spawned
  // them reports, matching how spawn_subagent(s) actually calls back
  // (see src/tools/spawn-subagent.ts).
  recorder.recordLlmCall({
    iteration: 0,
    role: 'subagent',
    agentId: 'subagent-0',
    model: 'llama3',
    ok: true,
    usage: { promptTokens: 30, completionTokens: 10 },
    durationMs: 80,
    calledAt: 1100,
  });
  recorder.recordLlmCall({
    iteration: 0,
    role: 'subagent',
    agentId: 'subagent-1',
    model: 'llama3',
    ok: true,
    usage: { promptTokens: 25, completionTokens: 9 },
    durationMs: 70,
    calledAt: 1105,
  });

  recorder.recordToolCall({
    iteration: 0,
    toolCalls: [{ name: 'spawn_subagents', arguments: { tasks: ['a', 'b'] } }],
    results: [{ ok: true, output: '[]' }],
    durationMs: 200,
  });

  recorder.recordMessage({ chatId: 1, reply: 'done', replySentAt: 1500, ok: true, iterations: 1 });

  const spans = exporter.getFinishedSpans();
  const messageSpan = byName(spans, 'handle_message')[0];
  const messageChildren = childrenOf(spans, messageSpan);

  // Only the main LLM call and the spawn_subagents tool call are direct
  // children of the message - the sub-agent calls are not siblings of them.
  assert.equal(messageChildren.length, 2);
  assert.equal(messageChildren.filter((s) => s.name === 'llm_call').length, 1);

  const toolSpan = messageChildren.find((s) => s.name === 'tool_call');
  assert.ok(toolSpan);
  const toolChildren = childrenOf(spans, toolSpan!);
  assert.equal(toolChildren.length, 2);
  assert.deepEqual(
    toolChildren.map((s) => s.attributes['gen_ai.agent.id']).sort(),
    ['subagent-0', 'subagent-1']
  );
});

test('a failed message is exported with its failure and reason rather than omitted or marked successful', () => {
  const { exporter, recorder } = setup();

  recorder.recordMessage({ chatId: 1, prompt: 'hi', receivedAt: 1000 });
  recorder.recordMessage({ chatId: 1, replySentAt: 1200, ok: false, reason: 'TIMEOUT', iterations: 1 });

  const spans = exporter.getFinishedSpans();
  const messageSpan = byName(spans, 'handle_message')[0];
  assert.equal(messageSpan.attributes['telegram_agent.ok'], false);
  assert.equal(messageSpan.attributes['telegram_agent.reason'], 'TIMEOUT');
  assert.equal(messageSpan.status.code, 2 /* SpanStatusCode.ERROR */);
});

test("an LLM call's category split and repeated/new input counts appear on its span, including tool_definition", () => {
  const { exporter, recorder } = setup();

  recorder.recordMessage({ chatId: 1, prompt: 'hi', receivedAt: 1000 });
  recorder.recordLlmCall({
    iteration: 0,
    model: 'llama3',
    ok: true,
    usage: { promptTokens: 100, completionTokens: 10 },
    durationMs: 50,
    calledAt: 1000,
    categoryTokens: {
      instructionTokens: 10,
      userRequestTokens: 20,
      conversationTokens: 30,
      toolOutputTokens: 15,
      toolDefinitionTokens: 25,
    },
    repeatedInput: { repeatedTokens: 60, newTokens: 40 },
  });
  recorder.recordMessage({ chatId: 1, reply: 'ok', replySentAt: 1100, ok: true, iterations: 1 });

  const spans = exporter.getFinishedSpans();
  const llmSpan = byName(spans, 'llm_call')[0];
  assert.equal(llmSpan.attributes['telegram_agent.context.instruction_tokens'], 10);
  assert.equal(llmSpan.attributes['telegram_agent.context.user_request_tokens'], 20);
  assert.equal(llmSpan.attributes['telegram_agent.context.conversation_tokens'], 30);
  assert.equal(llmSpan.attributes['telegram_agent.context.tool_output_tokens'], 15);
  assert.equal(llmSpan.attributes['telegram_agent.context.tool_definition_tokens'], 25);
  assert.equal(llmSpan.attributes['telegram_agent.context.repeated_tokens'], 60);
  assert.equal(llmSpan.attributes['telegram_agent.context.new_tokens'], 40);
});

test('a call whose derived figures were not computed omits those attributes instead of carrying zeroes', () => {
  const { exporter, recorder } = setup();

  recorder.recordMessage({ chatId: 1, prompt: 'hi', receivedAt: 1000 });
  recorder.recordLlmCall({
    iteration: 0,
    model: 'llama3',
    ok: true,
    usage: { promptTokens: 100, completionTokens: 10 },
    durationMs: 50,
    calledAt: 1000,
    // no categoryTokens / repeatedInput
  });
  recorder.recordMessage({ chatId: 1, reply: 'ok', replySentAt: 1100, ok: true, iterations: 1 });

  const spans = exporter.getFinishedSpans();
  const llmSpan = byName(spans, 'llm_call')[0];
  for (const key of [
    'telegram_agent.context.instruction_tokens',
    'telegram_agent.context.user_request_tokens',
    'telegram_agent.context.conversation_tokens',
    'telegram_agent.context.tool_output_tokens',
    'telegram_agent.context.tool_definition_tokens',
    'telegram_agent.context.repeated_tokens',
    'telegram_agent.context.new_tokens',
  ]) {
    assert.equal(llmSpan.attributes[key], undefined, `${key} should be omitted, not zero`);
  }
});

test('a call whose provider reported no cached-token count omits that attribute rather than setting it to zero', () => {
  const { exporter, recorder } = setup();

  recorder.recordMessage({ chatId: 1, prompt: 'hi', receivedAt: 1000 });
  recorder.recordLlmCall({
    iteration: 0,
    model: 'llama3',
    ok: true,
    usage: { promptTokens: 100, completionTokens: 10 }, // no cachedTokens/reasoningTokens
    durationMs: 50,
    calledAt: 1000,
  });
  recorder.recordMessage({ chatId: 1, reply: 'ok', replySentAt: 1100, ok: true, iterations: 1 });

  const spans = exporter.getFinishedSpans();
  const llmSpan = byName(spans, 'llm_call')[0];
  assert.equal(llmSpan.attributes['gen_ai.usage.cache_read_input_tokens'], undefined);
  assert.equal(llmSpan.attributes['gen_ai.usage.reasoning_output_tokens'], undefined);
  // reported fields are still present
  assert.equal(llmSpan.attributes['gen_ai.usage.input_tokens'], 100);
});

test('prompt and reply text are absent from exported spans when prompt storage is disabled', () => {
  const { exporter, recorder } = setup(false);

  recorder.recordMessage({ chatId: 1, prompt: 'a secret prompt', receivedAt: 1000 });
  recorder.recordMessage({ chatId: 1, reply: 'a secret reply', replySentAt: 1100, ok: true, iterations: 0 });

  const spans = exporter.getFinishedSpans();
  const messageSpan = byName(spans, 'handle_message')[0];
  assert.equal(messageSpan.attributes['telegram_agent.prompt'], undefined);
  assert.equal(messageSpan.attributes['telegram_agent.reply'], undefined);
});
