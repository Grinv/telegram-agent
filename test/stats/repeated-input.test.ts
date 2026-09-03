import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureRepeatedInput } from '../../src/stats/repeated-input.js';
import type { ChatMessage } from '../../src/llm/types.js';

test('a task\'s first call records no repeated input', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'Instructions' },
    { role: 'user', content: 'do the thing' },
  ];

  const { repeatedTokens, newTokens } = measureRepeatedInput(messages, undefined);

  assert.equal(repeatedTokens, 0);
  assert.ok(newTokens > 0);
});

test('a later turn that resends earlier content plus new tool output records the resent portion as repeated and only the new output as new', () => {
  const firstTurn: ChatMessage[] = [
    { role: 'system', content: 'Instructions' },
    { role: 'user', content: 'do the thing' },
  ];
  const secondTurn: ChatMessage[] = [
    ...firstTurn,
    { role: 'assistant', content: '', tool_calls: [{ name: 'read_file', arguments: { path: 'a.txt' } }] },
    { role: 'tool', content: 'brand new tool output that was not part of the first call', name: 'read_file' },
  ];

  const first = measureRepeatedInput(firstTurn, undefined);
  const second = measureRepeatedInput(secondTurn, firstTurn);

  assert.ok(second.repeatedTokens > 0, 'the resent prefix must be measured as repeated');
  assert.ok(second.newTokens > 0, 'the newly appended tool output must be measured as new');
  // The repeated portion should track what was actually resent (the first call's whole input).
  assert.equal(second.repeatedTokens, first.newTokens + first.repeatedTokens);
});

test('two different messages each record no repeated input on their first call, since repetition is measured per task', () => {
  const messageA: ChatMessage[] = [{ role: 'user', content: 'similar content here' }];
  const messageB: ChatMessage[] = [{ role: 'user', content: 'similar content here' }];

  // Each is a fresh task's first call - `previousMessages` is undefined for
  // both, regardless of how similar their content is to each other.
  const resultA = measureRepeatedInput(messageA, undefined);
  const resultB = measureRepeatedInput(messageB, undefined);

  assert.equal(resultA.repeatedTokens, 0);
  assert.equal(resultB.repeatedTokens, 0);
});

test('a message list that diverges partway through only counts the shared prefix as repeated', () => {
  const previous: ChatMessage[] = [
    { role: 'system', content: 'Instructions' },
    { role: 'user', content: 'do the thing' },
    { role: 'assistant', content: 'first attempt' },
  ];
  // Diverges at index 2 (a different assistant message) - the shared prefix is only indices 0-1.
  const current: ChatMessage[] = [
    { role: 'system', content: 'Instructions' },
    { role: 'user', content: 'do the thing' },
    { role: 'assistant', content: 'a completely different continuation' },
  ];

  const { repeatedTokens, newTokens } = measureRepeatedInput(current, previous);
  assert.ok(repeatedTokens > 0);
  assert.ok(newTokens > 0);
});
