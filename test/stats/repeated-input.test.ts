import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureRepeatedInput } from '../../src/stats/repeated-input.js';
import type { ChatMessage, ToolDefinition } from '../../src/llm/types.js';

const NO_TOOLS: ToolDefinition[] = [];

const SAMPLE_TOOLS: ToolDefinition[] = [
  { name: 'read_file', description: 'Reads a file from disk', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
  { name: 'write_file', description: 'Writes a file to disk', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } } },
];

test('a task\'s first call records no repeated input, including the tool definitions', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'Instructions' },
    { role: 'user', content: 'do the thing' },
  ];

  const withoutTools = measureRepeatedInput(messages, NO_TOOLS, undefined);
  assert.equal(withoutTools.repeatedTokens, 0);
  assert.ok(withoutTools.newTokens > 0);

  const withTools = measureRepeatedInput(messages, SAMPLE_TOOLS, undefined);
  assert.equal(withTools.repeatedTokens, 0);
  assert.ok(
    withTools.newTokens > withoutTools.newTokens,
    'the tool definitions must be counted as new on the first call, not omitted'
  );
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

  const first = measureRepeatedInput(firstTurn, SAMPLE_TOOLS, undefined);
  const second = measureRepeatedInput(secondTurn, SAMPLE_TOOLS, firstTurn);

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
  const resultA = measureRepeatedInput(messageA, SAMPLE_TOOLS, undefined);
  const resultB = measureRepeatedInput(messageB, SAMPLE_TOOLS, undefined);

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

  const { repeatedTokens, newTokens } = measureRepeatedInput(current, SAMPLE_TOOLS, previous);
  assert.ok(repeatedTokens > 0);
  assert.ok(newTokens > 0);
});

test('a task\'s second turn advertising the same tool definitions as its first records their tokens as repeated rather than new', () => {
  const firstTurn: ChatMessage[] = [
    { role: 'system', content: 'Instructions' },
    { role: 'user', content: 'do the thing' },
  ];
  const secondTurn: ChatMessage[] = [
    ...firstTurn,
    { role: 'assistant', content: '', tool_calls: [{ name: 'read_file', arguments: { path: 'a.txt' } }] },
    { role: 'tool', content: 'result', name: 'read_file' },
  ];

  const withoutTools = measureRepeatedInput(secondTurn, NO_TOOLS, firstTurn);
  const withTools = measureRepeatedInput(secondTurn, SAMPLE_TOOLS, firstTurn);

  assert.ok(
    withTools.repeatedTokens > withoutTools.repeatedTokens,
    'unchanged tool definitions must be counted as repeated on a later turn, not omitted'
  );
  assert.equal(withTools.newTokens, withoutTools.newTokens, 'the tool-definition tokens must not be added to the new count');
});
