import { trace, ROOT_CONTEXT, SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';
import {
  ATTR_GEN_AI_AGENT_ID,
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
  ATTR_GEN_AI_TOOL_NAME,
  ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
  ATTR_GEN_AI_USAGE_REASONING_OUTPUT_TOKENS,
} from '@opentelemetry/semantic-conventions/incubating';
import { computeCost, isPriced, type PriceTable } from './pricing.js';
import type { LlmCallStats, MessageStats, StatsRecorder, ToolCallStats } from './types.js';

const SUBAGENT_SPAWNING_TOOLS = new Set(['spawn_subagent', 'spawn_subagents']);

/**
 * Compile-time-only coverage maps: not read at runtime, exist purely so
 * adding a field to `MessageStats`/`LlmCallStats`/`ToolCallStats`
 * (`src/stats/types.ts`) is a type error here until someone adds it below
 * and states, in a comment, whether and how this recorder captures it (see
 * the note on `StatsRecorder` in `types.ts` for why - the same maps exist in
 * `sqlite-recorder.ts`, independently).
 */
const MESSAGE_STATS_FIELD_COVERAGE: Record<keyof MessageStats, true> = {
  chatId: true, // -> telegram_agent.chat_id; also keys `pendingByChat`/`currentPending`
  prompt: true, // -> telegram_agent.prompt, gated by storePrompts
  receivedAt: true, // -> handle_message span start time
  reply: true, // -> telegram_agent.reply, gated by storePrompts
  replySentAt: true, // -> handle_message span end time
  ok: true, // -> telegram_agent.ok, drives span status
  iterations: true, // -> telegram_agent.iterations
  reason: true, // -> telegram_agent.reason, drives span status message
};

const LLM_CALL_STATS_FIELD_COVERAGE: Record<keyof LlmCallStats, true> = {
  iteration: true, // -> telegram_agent.turn
  role: true, // -> telegram_agent.role
  agentId: true, // -> gen_ai.agent.id; also decides span nesting (subagent buffering)
  model: true, // -> gen_ai.request.model
  ok: true, // -> telegram_agent.ok, drives span status
  text: true, // deliberately not exported - matches sqlite-recorder.ts, see StatsRecorder note
  toolCalls: true, // deliberately not exported - matches sqlite-recorder.ts, see StatsRecorder note
  usage: true, // -> gen_ai.usage.*, telegram_agent.cost_usd
  durationMs: true, // used with calledAt to compute the span's end time
  calledAt: true, // used as the span's start time
  categoryTokens: true, // -> telegram_agent.context.{instruction,user_request,conversation,tool_output,tool_definition}_tokens
  repeatedInput: true, // -> telegram_agent.context.{repeated,new}_tokens
};

const TOOL_CALL_STATS_FIELD_COVERAGE: Record<keyof ToolCallStats, true> = {
  iteration: true, // -> telegram_agent.turn (unlike sqlite-recorder.ts, which has no column for this)
  toolCalls: true, // per-item -> gen_ai.tool.name, telegram_agent.input_size; one span per call
  results: true, // per-item -> telegram_agent.ok, telegram_agent.output_size, drives span status
  durationMs: true, // -> telegram_agent.duration_ms; also used to approximate the span's start time
};

interface PendingMessage {
  span: Span;
  receivedAt: number;
  toolCallCount: number;
  /** Subagent LLM-call stats recorded since the last tool call was drained, waiting for the tool call that spawned them. */
  pendingSubagentCalls: LlmCallStats[];
}

/** Only sets the attribute when `value` is not `undefined`, so an unreported measurement is omitted rather than written as a false zero. */
function setIfDefined(span: Span, key: string, value: string | number | boolean | undefined): void {
  if (value !== undefined) span.setAttribute(key, value);
}

/**
 * Emits the same activity `SqliteStatsRecorder` writes locally as an
 * OpenTelemetry trace: one span per handled message, a child span per LLM
 * call, a child span per tool call (see openspec/specs/agent-stats/spec.md -
 * "Recorded activity is exported as distributed traces").
 *
 * `recordLlmCall`/`recordToolCall` carry no message-correlating id, so - like
 * `SqliteStatsRecorder` - this recorder attributes them to the most recently
 * started message. This is correct as long as messages are processed
 * sequentially, matching the bot's normal one-at-a-time operation.
 *
 * A sub-agent's LLM-call spans (`role: 'subagent'`) are buffered rather than
 * started immediately, because they are recorded *before* the tool call that
 * spawned them (the tool call - e.g. `spawn_subagents` - only reports once
 * `sandboxExecutor.execute` resolves, which is after the sub-agent loops it
 * ran have already recorded their own LLM calls). They are attached as
 * children of that tool call's span once it arrives.
 */
export class OtelStatsRecorder implements StatsRecorder {
  private readonly tracer: Tracer;
  private readonly storePrompts: boolean;
  private readonly priceTable: PriceTable;

  private readonly pendingByChat = new Map<number, PendingMessage>();
  private currentPending?: PendingMessage;

  constructor(tracer: Tracer, storePrompts: boolean, priceTable: PriceTable = {}) {
    this.tracer = tracer;
    this.storePrompts = storePrompts;
    this.priceTable = priceTable;
  }

  recordMessage(stats: MessageStats): void {
    if (stats.receivedAt !== undefined) {
      this.startMessageSpan(stats);
    } else {
      this.endMessageSpan(stats);
    }
  }

  recordLlmCall(stats: LlmCallStats): void {
    if (!this.currentPending) return;

    if (stats.role === 'subagent') {
      this.currentPending.pendingSubagentCalls.push(stats);
      return;
    }

    const span = this.startLlmCallSpan(stats, this.currentPending.span);
    this.endLlmCallSpan(span, stats);
  }

  recordToolCall(stats: ToolCallStats): void {
    if (!this.currentPending) return;
    const pending = this.currentPending;

    let spawningSpan: Span | undefined;
    let lastSpan: Span | undefined;

    for (let i = 0; i < stats.toolCalls.length; i++) {
      const call = stats.toolCalls[i];
      const result = stats.results[i];
      const span = this.startToolCallSpan(stats, call, result, pending.span);
      lastSpan = span;
      if (SUBAGENT_SPAWNING_TOOLS.has(call.name)) spawningSpan = span;
      pending.toolCallCount += 1;
    }

    const nestUnder = spawningSpan ?? lastSpan ?? pending.span;
    for (const subagentStats of pending.pendingSubagentCalls) {
      const span = this.startLlmCallSpan(subagentStats, nestUnder);
      this.endLlmCallSpan(span, subagentStats);
    }
    pending.pendingSubagentCalls = [];
  }

  private startMessageSpan(stats: MessageStats): void {
    const receivedAt = stats.receivedAt as number;
    const span = this.tracer.startSpan('handle_message', { startTime: receivedAt });
    span.setAttribute('telegram_agent.chat_id', stats.chatId);
    if (this.storePrompts) setIfDefined(span, 'telegram_agent.prompt', stats.prompt);

    const pending: PendingMessage = { span, receivedAt, toolCallCount: 0, pendingSubagentCalls: [] };
    this.pendingByChat.set(stats.chatId, pending);
    this.currentPending = pending;
  }

  private endMessageSpan(stats: MessageStats): void {
    const pending = this.pendingByChat.get(stats.chatId);
    if (!pending) return;
    this.pendingByChat.delete(stats.chatId);

    // Any sub-agent calls buffered since the last tool call never saw a
    // matching tool call arrive (shouldn't happen in practice); attach them
    // to the message span directly rather than dropping them.
    for (const subagentStats of pending.pendingSubagentCalls) {
      const span = this.startLlmCallSpan(subagentStats, pending.span);
      this.endLlmCallSpan(span, subagentStats);
    }

    const endTime = stats.replySentAt ?? Date.now();
    if (this.storePrompts) setIfDefined(pending.span, 'telegram_agent.reply', stats.reply);
    setIfDefined(pending.span, 'telegram_agent.iterations', stats.iterations);
    pending.span.setAttribute('telegram_agent.tool_call_count', pending.toolCallCount);
    setIfDefined(pending.span, 'telegram_agent.ok', stats.ok);

    if (stats.ok === false) {
      pending.span.setAttribute('telegram_agent.reason', stats.reason ?? 'unknown');
      pending.span.setStatus({ code: SpanStatusCode.ERROR, message: stats.reason ?? 'unknown' });
    }

    pending.span.end(endTime);
  }

  private startLlmCallSpan(stats: LlmCallStats, parent: Span): Span {
    const parentContext = trace.setSpan(ROOT_CONTEXT, parent);
    const startTime = stats.calledAt;
    return this.tracer.startSpan('llm_call', startTime !== undefined ? { startTime } : {}, parentContext);
  }

  private endLlmCallSpan(span: Span, stats: LlmCallStats): void {
    span.setAttribute(ATTR_GEN_AI_OPERATION_NAME, 'chat');
    setIfDefined(span, ATTR_GEN_AI_REQUEST_MODEL, stats.model);
    setIfDefined(span, ATTR_GEN_AI_AGENT_ID, stats.agentId);
    span.setAttribute('telegram_agent.role', stats.role ?? 'main');
    span.setAttribute('telegram_agent.turn', stats.iteration);
    span.setAttribute('telegram_agent.ok', stats.ok);

    if (stats.usage) {
      span.setAttribute(ATTR_GEN_AI_USAGE_INPUT_TOKENS, stats.usage.promptTokens);
      span.setAttribute(ATTR_GEN_AI_USAGE_OUTPUT_TOKENS, stats.usage.completionTokens);
      setIfDefined(span, ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, stats.usage.cachedTokens);
      setIfDefined(span, ATTR_GEN_AI_USAGE_REASONING_OUTPUT_TOKENS, stats.usage.reasoningTokens);

      const model = stats.model ?? 'unknown';
      if (isPriced(model, this.priceTable)) {
        const cost = computeCost(
          { inputTokens: stats.usage.promptTokens, outputTokens: stats.usage.completionTokens },
          this.priceTable[model]
        );
        span.setAttribute('telegram_agent.cost_usd', cost);
      }
    }

    if (stats.categoryTokens) {
      span.setAttribute('telegram_agent.context.instruction_tokens', stats.categoryTokens.instructionTokens);
      span.setAttribute('telegram_agent.context.user_request_tokens', stats.categoryTokens.userRequestTokens);
      span.setAttribute('telegram_agent.context.conversation_tokens', stats.categoryTokens.conversationTokens);
      span.setAttribute('telegram_agent.context.tool_output_tokens', stats.categoryTokens.toolOutputTokens);
      span.setAttribute('telegram_agent.context.tool_definition_tokens', stats.categoryTokens.toolDefinitionTokens);
    }

    if (stats.repeatedInput) {
      span.setAttribute('telegram_agent.context.repeated_tokens', stats.repeatedInput.repeatedTokens);
      span.setAttribute('telegram_agent.context.new_tokens', stats.repeatedInput.newTokens);
    }

    if (!stats.ok) {
      span.setStatus({ code: SpanStatusCode.ERROR });
    }

    const endTime =
      stats.calledAt !== undefined && stats.durationMs !== undefined ? stats.calledAt + stats.durationMs : undefined;
    span.end(endTime);
  }

  private startToolCallSpan(
    stats: ToolCallStats,
    call: ToolCallStats['toolCalls'][number],
    result: ToolCallStats['results'][number] | undefined,
    parent: Span
  ): Span {
    const parentContext = trace.setSpan(ROOT_CONTEXT, parent);
    // `ToolCallStats` carries a duration but no start timestamp - `recordToolCall`
    // fires once execution has already finished, so "now minus duration" is the
    // best available approximation of when it started (mirrors how the message
    // span's own total duration is derived from a single end-side timestamp).
    const now = Date.now();
    const startTime = stats.durationMs !== undefined ? now - stats.durationMs : now;
    const span = this.tracer.startSpan('tool_call', { startTime }, parentContext);

    const ok = result?.ok ?? false;
    const outputText = ok ? (result?.output ?? '') : (result?.error ?? '');
    const inputSize = JSON.stringify(call.arguments).length;

    span.setAttribute(ATTR_GEN_AI_OPERATION_NAME, 'execute_tool');
    span.setAttribute(ATTR_GEN_AI_TOOL_NAME, call.name);
    span.setAttribute('telegram_agent.turn', stats.iteration);
    span.setAttribute('telegram_agent.ok', ok);
    span.setAttribute('telegram_agent.input_size', inputSize);
    span.setAttribute('telegram_agent.output_size', outputText.length);
    setIfDefined(span, 'telegram_agent.duration_ms', stats.durationMs);

    if (!ok) span.setStatus({ code: SpanStatusCode.ERROR });

    span.end(now);
    return span;
  }
}
