import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorizeInputTokens } from '../../src/stats/context-categories.js';
import type { ChatMessage, ToolDefinition } from '../../src/llm/types.js';

const NO_TOOLS: ToolDefinition[] = [];

const SAMPLE_TOOLS: ToolDefinition[] = [
  { name: 'read_file', description: 'Reads a file from disk', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
  { name: 'write_file', description: 'Writes a file to disk', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } } },
];

test('each category is present and the five shares sum exactly to the call\'s input tokens', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are a helpful assistant with tools.' },
    { role: 'user', content: 'What is the weather in Paris?' },
    { role: 'assistant', content: '', tool_calls: [{ name: 'weather', arguments: { city: 'Paris' } }] },
    { role: 'tool', content: 'Paris: 18C, partly cloudy', name: 'weather' },
    { role: 'user', content: 'And tomorrow?' },
  ];

  const totalInputTokens = 500;
  const shares = categorizeInputTokens(messages, SAMPLE_TOOLS, totalInputTokens);

  assert.ok(shares.instructionTokens > 0, 'instructions category should be non-empty');
  assert.ok(shares.userRequestTokens > 0, 'user-request category should be non-empty');
  assert.ok(shares.conversationTokens > 0, 'conversation category should be non-empty (the earlier user turn + assistant turn)');
  assert.ok(shares.toolOutputTokens > 0, 'tool-output category should be non-empty');
  assert.ok(shares.toolDefinitionTokens > 0, 'tool-definition category should be non-empty');

  const total =
    shares.instructionTokens + shares.userRequestTokens + shares.conversationTokens + shares.toolOutputTokens + shares.toolDefinitionTokens;
  assert.equal(total, totalInputTokens);
});

test('the last user-role message is the user request; earlier ones are conversation', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'Instructions' },
    { role: 'user', content: 'earlier turn' },
    { role: 'assistant', content: 'earlier reply' },
    { role: 'user', content: 'the current request' },
  ];

  const shares = categorizeInputTokens(messages, SAMPLE_TOOLS, 100);
  assert.equal(
    shares.instructionTokens + shares.userRequestTokens + shares.conversationTokens + shares.toolOutputTokens + shares.toolDefinitionTokens,
    100
  );
  assert.ok(shares.userRequestTokens > 0);
  assert.ok(shares.conversationTokens > 0);
});

test('a message list with no content and no tools produces all-zero shares rather than dividing by zero', () => {
  const shares = categorizeInputTokens([], NO_TOOLS, 0);
  assert.deepEqual(shares, {
    instructionTokens: 0,
    userRequestTokens: 0,
    conversationTokens: 0,
    toolOutputTokens: 0,
    toolDefinitionTokens: 0,
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
  const turn1Shares = categorizeInputTokens(turn1, SAMPLE_TOOLS, totalInputTokens);

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
  const turn2Shares = categorizeInputTokens(turn2, SAMPLE_TOOLS, totalInputTokens);

  assert.ok(
    turn2Shares.toolOutputTokens > turn1Shares.toolOutputTokens,
    'tool-output share must grow as more tool output accumulates'
  );
  assert.ok(
    turn2Shares.instructionTokens <= turn1Shares.instructionTokens,
    'instruction share must not grow across turns (the instruction text never changes)'
  );
});

test('tool definitions are attributed to their own category, not folded into any other', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'Instructions' },
    { role: 'user', content: 'do the thing' },
  ];

  const withoutTools = categorizeInputTokens(messages, NO_TOOLS, 200);
  const withTools = categorizeInputTokens(messages, SAMPLE_TOOLS, 200);

  assert.ok(withTools.toolDefinitionTokens > 0, 'advertised tool definitions must be attributed to the tool-definition category');
  assert.equal(withoutTools.toolDefinitionTokens, 0);

  // The presence of tool definitions must not inflate the other categories -
  // the tool-definition category exists precisely so they don't absorb it.
  assert.ok(withTools.instructionTokens <= withoutTools.instructionTokens);
});

test('categories account for the call\'s whole input with no unattributed remainder when tool definitions are present', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'Instructions' },
    { role: 'user', content: 'earlier turn' },
    { role: 'assistant', content: 'earlier reply' },
    { role: 'tool', content: 'some tool output', name: 'read_file' },
    { role: 'user', content: 'the current request' },
  ];

  const shares = categorizeInputTokens(messages, SAMPLE_TOOLS, 707);
  const total =
    shares.instructionTokens + shares.userRequestTokens + shares.conversationTokens + shares.toolOutputTokens + shares.toolDefinitionTokens;
  assert.equal(total, 707);
});

test('a call that advertises no tools attributes nothing to the tool-definition category while the remaining categories still account for the whole input', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'Instructions' },
    { role: 'user', content: 'do the thing' },
  ];

  const shares = categorizeInputTokens(messages, NO_TOOLS, 100);
  assert.equal(shares.toolDefinitionTokens, 0);
  assert.equal(shares.instructionTokens + shares.userRequestTokens + shares.conversationTokens + shares.toolOutputTokens, 100);
});

/** Mirrors `estimateTokens` from `src/stats/token-estimate.ts` (~4 chars/token, min 1 for non-empty text). */
function estimate(text: string): number {
  return text.length === 0 ? 0 : Math.max(1, Math.ceil(text.length / 4));
}

/** Mirrors the raw (pre-apportionment) size the source computes per message/tool, so a test can construct a
 * `totalInputTokens` that exactly matches the estimate - i.e. a provider whose reported total tracks actual
 * content precisely, the condition under which an unchanged category's apportioned share stays exactly fixed. */
function rawTotalOf(messages: ChatMessage[], tools: ToolDefinition[]): number {
  const messagesTotal = messages.reduce((sum, m) => {
    const toolCallsText = m.role === 'assistant' && m.tool_calls ? JSON.stringify(m.tool_calls) : '';
    return sum + estimate(m.content + toolCallsText);
  }, 0);
  const toolsTotal = tools.reduce((sum, t) => sum + estimate(JSON.stringify(t)), 0);
  return messagesTotal + toolsTotal;
}

test('two turns with byte-identical instructions and byte-identical tool definitions record identical figures for both categories, and only the changed categories differ', () => {
  const instruction: ChatMessage = { role: 'system', content: 'You are a helpful assistant with tools.' };
  const userRequest: ChatMessage = { role: 'user', content: 'Summarize these three files for me.' };

  const turn1: ChatMessage[] = [
    instruction,
    userRequest,
    { role: 'assistant', content: '', tool_calls: [{ name: 'read_file', arguments: { path: 'a.txt' } }] },
    { role: 'tool', content: 'contents of file a', name: 'read_file' },
  ];
  const turn2: ChatMessage[] = [
    ...turn1,
    { role: 'assistant', content: '', tool_calls: [{ name: 'read_file', arguments: { path: 'b.txt' } }] },
    { role: 'tool', content: 'contents of file b, quite a bit more text than file a had in it', name: 'read_file' },
  ];

  // A provider whose reported total exactly tracks actual content growth (the total this
  // change's own estimate would report, used as the "ground truth" input token count for
  // each turn) - the realistic condition under which a category whose raw content did not
  // change keeps an identical apportioned share turn to turn, since the total grows in step
  // with the raw estimate rather than being held artificially fixed.
  const turn1Shares = categorizeInputTokens(turn1, SAMPLE_TOOLS, rawTotalOf(turn1, SAMPLE_TOOLS));
  const turn2Shares = categorizeInputTokens(turn2, SAMPLE_TOOLS, rawTotalOf(turn2, SAMPLE_TOOLS));

  assert.equal(turn1Shares.instructionTokens, turn2Shares.instructionTokens);
  assert.equal(turn1Shares.toolDefinitionTokens, turn2Shares.toolDefinitionTokens);
  assert.notEqual(turn1Shares.toolOutputTokens, turn2Shares.toolOutputTokens);
});
