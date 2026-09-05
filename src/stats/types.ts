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
  /**
   * Who made this call: "main" (the loop's think step, the default),
   * "classifier" (model routing), "subagent" (a spawned sub-agent loop), or
   * "compaction" (the summarization call conversation compaction makes when
   * the threshold is crossed - see `src/context-management/`, whose own
   * tokens must be counted against the triggering message rather than
   * hidden from measurement).
   */
  role?: 'main' | 'classifier' | 'subagent' | 'compaction';
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
 * `undefined`, the loop skips all stats recording. `LlmResult` is accepted
 * where the full result shape (success or failure) is relevant.
 *
 * Two independent implementations exist - `SqliteStatsRecorder` (local
 * database) and `OtelStatsRecorder` (trace export) - composed together by
 * `CompositeStatsRecorder` (see `src/stats/composite-recorder.ts`). Neither
 * recomputes a value the other already has; both are handed the exact same
 * `MessageStats`/`LlmCallStats`/`ToolCallStats` object, so the *values* can
 * never disagree. What each recorder does independently decide is which
 * fields of that object it captures and how - so a field added to one of
 * these three interfaces can silently reach only one of the two recorders.
 * Both `sqlite-recorder.ts` and `otel-exporter.ts` keep a
 * `Record<keyof T, true>` coverage map for each of these types right next to
 * their mapping code, specifically so adding a field here is a compile
 * error in both files until someone decides, and states in a comment,
 * whether and how the new field is captured there - see those maps before
 * adding a field.
 */
export interface StatsRecorder {
  recordMessage(stats: MessageStats): void;
  recordLlmCall(stats: LlmCallStats): void;
  recordToolCall(stats: ToolCallStats): void;
}
