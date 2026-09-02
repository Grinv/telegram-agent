import type { ToolCall, ToolResult, TokenUsage } from '../llm/types.js';

/**
 * Stats emitted at message-received and reply-sent hook points. Fields are
 * optional so the same type covers both events: `receivedAt`/`prompt` on
 * receive; `replySentAt`/`reply`/`ok`/`iterations` on completion.
 */
export interface MessageStats {
  chatId: number;
  prompt?: string;
  receivedAt?: number;
  reply?: string;
  replySentAt?: number;
  ok?: boolean;
  iterations?: number;
  /** Failure reason (e.g. "TIMEOUT", "MAX_ITERATIONS"), present when `ok` is false. */
  reason?: string;
}

/** Stats emitted after each LLM call inside the think → act → observe loop. */
export interface LlmCallStats {
  iteration: number;
  /** Who made this call: "main" (the loop's think step, the default) or "classifier" (model routing). */
  role?: 'main' | 'classifier';
  model?: string;
  ok: boolean;
  text?: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
  durationMs?: number;
}

/** Stats emitted after executing all tool calls for one loop iteration. */
export interface ToolCallStats {
  iteration: number;
  toolCalls: ToolCall[];
  results: ToolResult[];
  durationMs?: number;
}

/**
 * Optional dependency the orchestrator calls at defined hook points. When
 * `undefined`, the loop skips all stats recording. Implementation is deferred
 * to a separate change; this interface is the only contract the orchestrator
 * depends on. `LlmResult` is accepted where the full result shape (success or
 * failure) is relevant.
 */
export interface StatsRecorder {
  recordMessage(stats: MessageStats): void;
  recordLlmCall(stats: LlmCallStats): void;
  recordToolCall(stats: ToolCallStats): void;
}
