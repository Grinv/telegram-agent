import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CompositeStatsRecorder } from '../../src/stats/composite-recorder.js';
import type { LlmCallStats, MessageStats, StatsRecorder, ToolCallStats } from '../../src/stats/types.js';

class RecordingStatsRecorder implements StatsRecorder {
  messages: MessageStats[] = [];
  llmCalls: LlmCallStats[] = [];
  toolCalls: ToolCallStats[] = [];

  recordMessage(stats: MessageStats): void {
    this.messages.push(stats);
  }
  recordLlmCall(stats: LlmCallStats): void {
    this.llmCalls.push(stats);
  }
  recordToolCall(stats: ToolCallStats): void {
    this.toolCalls.push(stats);
  }
}

test('the composite recorder writes to each wrapped recorder exactly what it was passed, unmodified', () => {
  const sqliteLike = new RecordingStatsRecorder();
  const exporterLike = new RecordingStatsRecorder();
  const composite = new CompositeStatsRecorder([sqliteLike, exporterLike]);

  const messageStats: MessageStats = { chatId: 42, prompt: 'hi', receivedAt: 1000 };
  const llmCallStats: LlmCallStats = {
    iteration: 0,
    model: 'llama3',
    ok: true,
    usage: { promptTokens: 10, completionTokens: 5 },
    durationMs: 100,
  };
  const toolCallStats: ToolCallStats = {
    iteration: 0,
    toolCalls: [{ name: 'echo', arguments: { text: 'hi' } }],
    results: [{ ok: true, output: 'hi' }],
    durationMs: 30,
  };

  composite.recordMessage(messageStats);
  composite.recordLlmCall(llmCallStats);
  composite.recordToolCall(toolCallStats);

  for (const recorder of [sqliteLike, exporterLike]) {
    assert.deepEqual(recorder.messages, [messageStats]);
    assert.deepEqual(recorder.llmCalls, [llmCallStats]);
    assert.deepEqual(recorder.toolCalls, [toolCallStats]);
    // Same object references, not copies - composition cannot alter what
    // the wrapped recorder receives.
    assert.equal(recorder.messages[0], messageStats);
    assert.equal(recorder.llmCalls[0], llmCallStats);
    assert.equal(recorder.toolCalls[0], toolCallStats);
  }
});
