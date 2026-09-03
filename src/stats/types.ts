import type { ToolCall, ToolResult, TokenUsage } from '../llm/types.js';
import type { ContextCategoryTokens } from './context-categories.js';
import type { RepeatedInputTokens } from './repeated-input.js';

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
  /** Who made this call: "main" (the loop's think step, the default), "classifier" (model routing), or "subagent" (a spawned sub-agent loop). */
  role?: 'main' | 'classifier' | 'subagent';
  /**
   * Identity of the specific agent that made this call - distinguishes
   * concurrent sub-agents from each other, unlike `role` which only says
   * *what kind* of agent. Defaults to `role` (or "main" when `role` is also
   * absent) when omitted.
   */
  agentId?: string;
  model?: string;
  ok: boolean;
  text?: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
  durationMs?: number;
  /** Time the call was made (ms since epoch, `Date.now()`). Omitted only for calls made before this field existed. */
  calledAt?: number;
  /** Per-content-category share of this call's input tokens. See `src/stats/context-categories.ts`. */
  categoryTokens?: ContextCategoryTokens;
  /** How much of this call's input was already sent earlier in the same task, vs new. See `src/stats/repeated-input.ts`. */
  repeatedInput?: RepeatedInputTokens;
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
