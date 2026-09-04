import type { ChatMessage, ToolDefinition } from '../llm/types.js';
import { estimateTokens } from './token-estimate.js';
import { estimatedToolDefinitionsSize } from './context-categories.js';

/** How much of one LLM call's input was already sent in an earlier call of the same task, vs is new. */
export interface RepeatedInputTokens {
  repeatedTokens: number;
  newTokens: number;
}

function messageText(message: ChatMessage): string {
  const toolCallsText = message.role === 'assistant' && message.tool_calls ? JSON.stringify(message.tool_calls) : '';
  return message.content + toolCallsText;
}

function messagesEqual(a: ChatMessage, b: ChatMessage): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Pure: measures how much of `messages` plus the call's advertised `tools`
 * (the input about to be sent) was already sent to the model in
 * `previousMessages` (the input sent on the immediately preceding call of
 * the same task), computed by us rather than read from the provider.
 * `previousMessages` is `undefined` for a task's first call, for which
 * nothing has been sent before - including the tool definitions, which
 * therefore count as new exactly once per task.
 *
 * Within one think→act→observe loop the message list only ever grows -
 * assistant/tool turns are appended, never edited or removed - and the tool
 * definitions are fixed for the whole loop, so on every call after the
 * first, the repeated portion is the shared message prefix plus the whole
 * tool-definition block.
 */
export function measureRepeatedInput(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  previousMessages: ChatMessage[] | undefined
): RepeatedInputTokens {
  const toolDefinitionTokens = estimatedToolDefinitionsSize(tools);

  if (!previousMessages) {
    return {
      repeatedTokens: 0,
      newTokens: estimateTokens(messages.map(messageText).join('\n')) + toolDefinitionTokens,
    };
  }

  let sharedCount = 0;
  const maxShared = Math.min(messages.length, previousMessages.length);
  while (sharedCount < maxShared && messagesEqual(messages[sharedCount], previousMessages[sharedCount])) {
    sharedCount++;
  }

  return {
    repeatedTokens: estimateTokens(messages.slice(0, sharedCount).map(messageText).join('\n')) + toolDefinitionTokens,
    newTokens: estimateTokens(messages.slice(sharedCount).map(messageText).join('\n')),
  };
}
