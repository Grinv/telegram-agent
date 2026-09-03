import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorizeInputTokens } from '../../src/stats/context-categories.js';
import type { ChatMessage } from '../../src/llm/types.js';

test('each category is present and the four shares sum exactly to the call\'s input tokens', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are a helpful assistant with tools.' },
    { role: 'user', content: 'What is the weather in Paris?' },
    { role: 'assistant', content: '', tool_calls: [{ name: 'weather', arguments: { city: 'Paris' } }] },
    { role: 'tool', content: 'Paris: 18C, partly cloudy', name: 'weather' },
    { role: 'user', content: 'And tomorrow?' },
  ];

  const totalInputTokens = 500;
  const shares = categorizeInputTokens(messages, totalInputTokens);

  assert.ok(shares.instructionTokens > 0, 'instructions category should be non-empty');
  assert.ok(shares.userRequestTokens > 0, 'user-request category should be non-empty');
  assert.ok(shares.conversationTokens > 0, 'conversation category should be non-empty (the earlier user turn + assistant turn)');
  assert.ok(shares.toolOutputTokens > 0, 'tool-output category should be non-empty');

  const total = shares.instructionTokens + shares.userRequestTokens + shares.conversationTokens + shares.toolOutputTokens;
  assert.equal(total, totalInputTokens);
});

test('the last user-role message is the user request; earlier ones are conversation', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'Instructions' },
    { role: 'user', content: 'earlier turn' },
    { role: 'assistant', content: 'earlier reply' },
    { role: 'user', content: 'the current request' },
  ];

  const shares = categorizeInputTokens(messages, 100);
  assert.equal(shares.instructionTokens + shares.userRequestTokens + shares.conversationTokens + shares.toolOutputTokens, 100);
  assert.ok(shares.userRequestTokens > 0);
  assert.ok(shares.conversationTokens > 0);
});

test('a message list with no content produces all-zero shares rather than dividing by zero', () => {
  const shares = categorizeInputTokens([], 0);
  assert.deepEqual(shares, {
    instructionTokens: 0,
    userRequestTokens: 0,
    conversationTokens: 0,
    toolOutputTokens: 0,
  });
});

test('across turns during which tool output accumulates, the tool-output share grows while the instruction share does not', () => {
  const instruction: ChatMessage = { role: 'system', content: 'You are a helpful assistant with tools.' };
  const userRequest: ChatMessage = { role: 'user', content: 'Summarize these three files for me.' };

  // Turn 1: one tool result so far.
  const turn1: ChatMessage[] = [
    instruction,
    userRequest,
    { role: 'assistant', content: '', tool_calls: [{ name: 'read_file', arguments: { path: 'a.txt' } }] },
    { role: 'tool', content: 'contents of file a, some meaningful amount of text here', name: 'read_file' },
  ];
  const totalInputTokens = 300;
  const turn1Shares = categorizeInputTokens(turn1, totalInputTokens);

  // Turn 2: the same history plus two more, larger tool results.
  const turn2: ChatMessage[] = [
    ...turn1,
    { role: 'assistant', content: '', tool_calls: [{ name: 'read_file', arguments: { path: 'b.txt' } }] },
    { role: 'tool', content: 'contents of file b, quite a bit more text than file a had in it', name: 'read_file' },
    { role: 'assistant', content: '', tool_calls: [{ name: 'read_file', arguments: { path: 'c.txt' } }] },
    { role: 'tool', content: 'contents of file c, and this one is longer still than both a and b combined', name: 'read_file' },
  ];
  // Same reported input-token budget both turns: this isolates the effect
  // of tool output taking up a growing proportion of that budget as it
  // accumulates, from any change in the budget itself.
  const turn2Shares = categorizeInputTokens(turn2, totalInputTokens);

  assert.ok(
    turn2Shares.toolOutputTokens > turn1Shares.toolOutputTokens,
    'tool-output share must grow as more tool output accumulates'
  );
  assert.ok(
    turn2Shares.instructionTokens <= turn1Shares.instructionTokens,
    'instruction share must not grow across turns (the instruction text never changes)'
  );
});
