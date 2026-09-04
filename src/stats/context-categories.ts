import type { ChatMessage, ToolDefinition } from '../llm/types.js';
import { estimateTokens } from './token-estimate.js';

/** Per-content-category share of one LLM call's input tokens. Always sums to the call's total input tokens. */
export interface ContextCategoryTokens {
  instructionTokens: number;
  userRequestTokens: number;
  conversationTokens: number;
  toolOutputTokens: number;
  /** The definitions of the tools advertised to the model - generated from the registered tools, distinct from the hand-authored instruction text. */
  toolDefinitionTokens: number;
}

type Category = 'instruction' | 'userRequest' | 'conversation' | 'toolOutput' | 'toolDefinition';

function categoryOf(message: ChatMessage, lastUserIndex: number, index: number): Category {
  if (message.role === 'system') return 'instruction';
  if (message.role === 'tool') return 'toolOutput';
  if (message.role === 'user' && index === lastUserIndex) return 'userRequest';
  return 'conversation';
}

function estimatedSize(message: ChatMessage): number {
  const toolCallsText = message.role === 'assistant' && message.tool_calls ? JSON.stringify(message.tool_calls) : '';
  return estimateTokens(message.content + toolCallsText);
}

/** Estimated size of the tool definitions advertised to the model, summed per tool (mirrors `estimatedSize` per message). */
export function estimatedToolDefinitionsSize(tools: ToolDefinition[]): number {
  return tools.reduce((sum, tool) => sum + estimateTokens(JSON.stringify(tool)), 0);
}

/**
 * Pure: classifies `messages` and the call's advertised `tools` into the
 * five content categories - the agent's own instructions (the `system`
 * message), the definitions of the tools advertised to the model (`tools`,
 * generated from the registered tools rather than authored by hand), the
 * user's request (the last `user`-role message, since no further one is
 * appended once a think→act→observe loop starts), the conversation that
 * preceded it (every other `user`/`assistant` message: prior history plus
 * this task's own earlier turns), and tool output (`tool`-role messages) -
 * and splits `totalInputTokens` (the provider-reported input token count for
 * this call, which includes the tool definitions even though they travel
 * outside `messages`) across them in proportion to each category's
 * estimated share of the content (see `estimateTokens`), so the five
 * numbers always sum to exactly `totalInputTokens` (rounding remainder goes
 * to the largest category).
 */
export function categorizeInputTokens(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  totalInputTokens: number
): ContextCategoryTokens {
  const lastUserIndex = messages.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1);

  const raw: Record<Category, number> = { instruction: 0, userRequest: 0, conversation: 0, toolOutput: 0, toolDefinition: 0 };
  messages.forEach((message, index) => {
    raw[categoryOf(message, lastUserIndex, index)] += estimatedSize(message);
  });
  raw.toolDefinition = estimatedToolDefinitionsSize(tools);

  const rawTotal = raw.instruction + raw.userRequest + raw.conversation + raw.toolOutput + raw.toolDefinition;

  if (totalInputTokens <= 0 || rawTotal === 0) {
    return { instructionTokens: 0, userRequestTokens: 0, conversationTokens: 0, toolOutputTokens: 0, toolDefinitionTokens: 0 };
  }

  const shares: Record<Category, number> = {
    instruction: Math.round((totalInputTokens * raw.instruction) / rawTotal),
    userRequest: Math.round((totalInputTokens * raw.userRequest) / rawTotal),
    conversation: Math.round((totalInputTokens * raw.conversation) / rawTotal),
    toolOutput: Math.round((totalInputTokens * raw.toolOutput) / rawTotal),
    toolDefinition: Math.round((totalInputTokens * raw.toolDefinition) / rawTotal),
  };

  // Rounding can leave the sum off by a small remainder; reconcile it against
  // the largest category so the categories always account for the full total.
  const roundedTotal = shares.instruction + shares.userRequest + shares.conversation + shares.toolOutput + shares.toolDefinition;
  const remainder = totalInputTokens - roundedTotal;
  if (remainder !== 0) {
    const largest = (Object.keys(raw) as Category[]).reduce((a, b) => (raw[b] > raw[a] ? b : a));
    shares[largest] += remainder;
  }

  return {
    instructionTokens: shares.instruction,
    userRequestTokens: shares.userRequest,
    conversationTokens: shares.conversation,
    toolOutputTokens: shares.toolOutput,
    toolDefinitionTokens: shares.toolDefinition,
  };
}
