import type { ChatMessage } from '../llm/types.js';
import { estimateTokens } from './token-estimate.js';

/** Per-content-category share of one LLM call's input tokens. Always sums to the call's total input tokens. */
export interface ContextCategoryTokens {
  instructionTokens: number;
  userRequestTokens: number;
  conversationTokens: number;
  toolOutputTokens: number;
}

type Category = 'instruction' | 'userRequest' | 'conversation' | 'toolOutput';

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

/**
 * Pure: classifies `messages` into the four content categories - the agent's
 * own instructions (the `system` message), the user's request (the last
 * `user`-role message, since no further one is appended once a
 * think→act→observe loop starts), the conversation that preceded it (every
 * other `user`/`assistant` message: prior history plus this task's own
 * earlier turns), and tool output (`tool`-role messages) - and splits
 * `totalInputTokens` (the provider-reported input token count for this
 * call) across them in proportion to each category's estimated share of the
 * text (see `estimateTokens`), so the four numbers always sum to exactly
 * `totalInputTokens` (rounding remainder goes to the largest category).
 */
export function categorizeInputTokens(messages: ChatMessage[], totalInputTokens: number): ContextCategoryTokens {
  const lastUserIndex = messages.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1);

  const raw: Record<Category, number> = { instruction: 0, userRequest: 0, conversation: 0, toolOutput: 0 };
  messages.forEach((message, index) => {
    raw[categoryOf(message, lastUserIndex, index)] += estimatedSize(message);
  });

  const rawTotal = raw.instruction + raw.userRequest + raw.conversation + raw.toolOutput;

  if (totalInputTokens <= 0 || rawTotal === 0) {
    return { instructionTokens: 0, userRequestTokens: 0, conversationTokens: 0, toolOutputTokens: 0 };
  }

  const shares: Record<Category, number> = {
    instruction: Math.round((totalInputTokens * raw.instruction) / rawTotal),
    userRequest: Math.round((totalInputTokens * raw.userRequest) / rawTotal),
    conversation: Math.round((totalInputTokens * raw.conversation) / rawTotal),
    toolOutput: Math.round((totalInputTokens * raw.toolOutput) / rawTotal),
  };

  // Rounding can leave the sum off by a small remainder; reconcile it against
  // the largest category so the categories always account for the full total.
  const roundedTotal = shares.instruction + shares.userRequest + shares.conversation + shares.toolOutput;
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
  };
}
