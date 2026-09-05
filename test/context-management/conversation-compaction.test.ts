import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactConversation, estimateConversationTokens } from '../../src/context-management/conversation-compaction.js';
import type { ChatMessage, LlmRequest, LlmResult } from '../../src/llm/types.js';
import type { StatsRecorder, LlmCallStats } from '../../src/stats/types.js';

function scriptedCallLlm(result: LlmResult): { fn: (request: LlmRequest) => Promise<LlmResult>; calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    fn: async (request: LlmRequest) => {
      calls.push(request);
      return result;
    },
  };
}

function longTurn(role: 'user' | 'assistant', label: string, repeat = 500): ChatMessage {
  return { role, content: `${label}: ${'word '.repeat(repeat)}` };
}

test('a conversation within the threshold is sent whole, with no LLM call made', async () => {
  const messages: ChatMessage[] = [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ];
  const { fn: callLlm, calls } = scriptedCallLlm({ ok: true, text: 'summary' });

  const result = await compactConversation(messages, 4000, { callLlm, provider: 'stub', timeoutMs: 1000 });

  assert.equal(result.compacted, false);
  assert.deepEqual(result.messages, messages);
  assert.equal(calls.length, 0, 'a short conversation must never trigger a summarization call');
});

test('a conversation above the threshold is compacted: recent turns intact, a summary in place of earlier ones, and smaller than uncompacted', async () => {
  const messages: ChatMessage[] = [
    longTurn('user', 'turn1'),
    longTurn('assistant', 'turn2'),
    longTurn('user', 'turn3'),
    { role: 'assistant', content: 'recent short reply' },
  ];
  const uncompactedSize = estimateConversationTokens(messages);
  const { fn: callLlm } = scriptedCallLlm({ ok: true, text: 'summary of earlier turns' });

  const result = await compactConversation(messages, 200, { callLlm, provider: 'stub', timeoutMs: 1000 });

  assert.equal(result.compacted, true);
  assert.ok(result.messages.length < messages.length, 'earlier turns are collapsed into one summary message');
  assert.equal(result.messages[result.messages.length - 1].content, 'recent short reply', 'the most recent turn is kept intact');
  assert.ok(result.messages.some((m) => m.content.includes('summary of earlier turns')), 'a summary message is present');
  assert.ok(estimateConversationTokens(result.messages) < uncompactedSize, 'the compacted form is smaller than the uncompacted one');
});

test('a fact stated in a summarized turn is still available in the compacted output', async () => {
  const messages: ChatMessage[] = [
    { role: 'user', content: 'my favorite number is 42' },
    { role: 'assistant', content: 'noted' },
    longTurn('user', 'padding-1'),
    longTurn('assistant', 'padding-2'),
    { role: 'user', content: 'what is my favorite number again?' },
  ];
  const { fn: callLlm, calls } = scriptedCallLlm({ ok: true, text: "The user's favorite number is 42." });

  const result = await compactConversation(messages, 150, { callLlm, provider: 'stub', timeoutMs: 1000 });

  assert.equal(result.compacted, true);
  assert.ok(calls[0].prompt.includes('42'), 'the summarization call is given the fact-bearing turn to summarize');
  assert.ok(result.messages.some((m) => m.content.includes('42')), 'the fact survives into the compacted output via the summary');
});

test('the summarization call\'s own stats are recorded with role "compaction", attributing its cost to the triggering message', async () => {
  const messages: ChatMessage[] = [longTurn('user', 'turn1'), longTurn('assistant', 'turn2'), { role: 'user', content: 'recent' }];
  const { fn: callLlm } = scriptedCallLlm({ ok: true, text: 'summary', usage: { promptTokens: 50, completionTokens: 10 } });

  const recorded: LlmCallStats[] = [];
  const statsRecorder: StatsRecorder = {
    recordMessage: () => {},
    recordLlmCall: (stats) => recorded.push(stats),
    recordToolCall: () => {},
  };

  await compactConversation(messages, 100, { callLlm, provider: 'stub', timeoutMs: 1000, statsRecorder });

  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].role, 'compaction');
  assert.deepEqual(recorded[0].usage, { promptTokens: 50, completionTokens: 10 });
});

test('when the summarization call fails, compaction still returns recent turns with a placeholder summary rather than throwing', async () => {
  const messages: ChatMessage[] = [longTurn('user', 'turn1'), longTurn('assistant', 'turn2'), { role: 'user', content: 'recent' }];
  const callLlm = async (): Promise<LlmResult> => ({ ok: false, reason: 'TIMEOUT', message: 'too slow' });

  const result = await compactConversation(messages, 100, { callLlm, provider: 'stub', timeoutMs: 1000 });

  assert.equal(result.compacted, true);
  assert.equal(result.messages[result.messages.length - 1].content, 'recent');
});
