import { callLlmIsolated } from './llm/inference-caller.js';
import { FAILURE_LABELS } from './llm/failure-labels.js';
import type {
  ChatMessage,
  LlmRequest,
  LlmResult,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from './llm/types.js';
import type { StatsRecorder } from './stats/types.js';
import { categorizeInputTokens, type ContextCategoryTokens } from './stats/context-categories.js';
import { measureRepeatedInput, type RepeatedInputTokens } from './stats/repeated-input.js';
import type { SandboxExecutor } from './sandbox/sandbox-executor.js';
import type { ToolRegistry } from './tools/registry.js';
import { logger } from './logger.js';
import type { TelegramMessage, TelegramReplier } from './telegram/client.js';
import type { Router } from './routing/types.js';
import type { SkillLibrary } from './skills/types.js';
import { buildRequestPrefix } from './context-management/prefix.js';
import { compactConversation } from './context-management/conversation-compaction.js';
import { DEFAULT_CONVERSATION_COMPACTION_THRESHOLD } from './context-management/defaults.js';
import type { HistoryStore, HistoryTurn } from './history/types.js';

const FAILURE_REPLY_TEXT = 'Sorry, I could not process your message right now. Please try again later.';
const NEW_CONVERSATION_COMMAND = '/new';
const NEW_CONVERSATION_REPLY_TEXT = "Started a new conversation. I've forgotten everything discussed in this chat so far.";

/** Renders a stored/incoming user turn's display content, prefixed with the sender's name when known. */
function renderUserContent(content: string, senderName?: string): string {
  return senderName ? `${senderName}: ${content}` : content;
}

/** Renders a persisted history turn into the `ChatMessage` shape sent to the LLM. */
function renderHistoryTurn(turn: HistoryTurn): ChatMessage {
  if (turn.role === 'assistant') {
    return { role: 'assistant', content: turn.content };
  }
  return { role: 'user', content: renderUserContent(turn.content, turn.senderName) };
}

/** Dependencies for the think → act → observe loop. */
export interface LoopDeps {
  callLlm: (request: LlmRequest, options: { provider: string; timeoutMs: number }) => Promise<LlmResult>;
  provider: string;
  timeoutMs: number;
  sandboxExecutor: SandboxExecutor;
  toolRegistry: ToolRegistry;
  statsRecorder?: StatsRecorder;
  maxIterations: number;
  model?: string;
  /** Who is running this loop: "main" (default), "classifier", or "subagent". Passed through to stats. */
  role?: 'main' | 'classifier' | 'subagent';
  /**
   * Identity of the specific agent running this loop (e.g. "subagent-2"),
   * distinguishing it from other concurrent agents sharing the same `role`.
   * Passed through to stats; defaults to `role` (or "main") when omitted.
   */
  agentId?: string;
}

export type LoopResult = { ok: true; text: string; iterations: number } | { ok: false; reason: string; iterations: number };

/**
 * Standalone think → act → observe loop. Callable independently of
 * `createMessageHandler` so a later change (subagents) can invoke it
 * recursively without duplicating orchestrator logic.
 *
 * 1. Send messages + tools to the LLM.
 * 2. If the LLM returns tool calls, execute them in a fresh sandbox.
 * 3. Feed results back as observations.
 * 4. Repeat until a final text answer or max iterations.
 */
export async function runLoop(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  deps: LoopDeps,
): Promise<LoopResult> {
  const { callLlm, provider, timeoutMs, sandboxExecutor, toolRegistry, statsRecorder, maxIterations, model, role, agentId } = deps;

  // Tracks the message list as it was sent on the previous iteration of
  // *this* loop invocation, so repeated-input can be measured against it.
  // `undefined` on the first iteration - a task's first call has nothing
  // earlier to repeat. Scoped to this function call, not shared across
  // sibling loops (e.g. concurrent sub-agents), matching "repetition is
  // measured per task".
  let previousMessages: ChatMessage[] | undefined;

  for (let i = 0; i < maxIterations; i++) {
    const request: LlmRequest = {
      prompt: extractLatestUserText(messages),
      messages,
      ...(tools.length > 0 ? { tools } : {}),
      ...(model ? { model } : {}),
    };

    const requestMessages = [...messages];
    const startedAt = Date.now();
    const result = await callLlm(request, { provider, timeoutMs });
    const durationMs = Date.now() - startedAt;

    const { categoryTokens, repeatedInput } = measureContextStats(
      requestMessages,
      tools,
      previousMessages,
      result.ok ? result.usage : undefined,
    );
    previousMessages = requestMessages;

    statsRecorder?.recordLlmCall({
      iteration: i,
      ...(role ? { role } : {}),
      ...(agentId ? { agentId } : {}),
      ...(model ? { model } : {}),
      ok: result.ok,
      ...(result.ok ? { text: result.text, ...(result.toolCalls ? { toolCalls: result.toolCalls } : {}) } : {}),
      ...(result.ok && result.usage ? { usage: result.usage } : {}),
      durationMs,
      calledAt: startedAt,
      ...(categoryTokens ? { categoryTokens } : {}),
      ...(repeatedInput ? { repeatedInput } : {}),
    });

    if (!result.ok) {
      logger.error(FAILURE_LABELS[result.reason], { reason: result.reason, detail: result.message });
      return { ok: false, reason: result.reason, iterations: i + 1 };
    }

    if (!result.toolCalls || result.toolCalls.length === 0) {
      if (result.text.trim().length === 0) {
        logger.warn('LLM returned an empty response with no tool call', { iteration: i, model });
        return { ok: false, reason: 'EMPTY_RESPONSE', iterations: i + 1 };
      }
      return { ok: true, text: result.text, iterations: i + 1 };
    }

    const toolCallStartedAt = Date.now();
    const observations = await sandboxExecutor.execute(result.toolCalls, toolRegistry);
    const toolCallDurationMs = Date.now() - toolCallStartedAt;

    statsRecorder?.recordToolCall({
      iteration: i,
      toolCalls: result.toolCalls,
      results: observations,
      durationMs: toolCallDurationMs,
    });

    logger.info('Tool call executed', {
      iteration: i,
      toolCalls: result.toolCalls.map((tc) => tc.name),
      results: observations.map((o) => ({ name: o.name, ok: o.ok })),
    });

    messages.push({
      role: 'assistant',
      content: result.text,
      ...(result.toolCalls ? { tool_calls: result.toolCalls } : {}),
    });

    for (const obs of observations) {
      messages.push({
        role: 'tool',
        content: obs.ok ? (obs.output ?? '') : (obs.error ?? 'Tool failed'),
        name: obs.name,
      });
    }
  }

  logger.warn('Max iterations reached', { maxIterations });
  return { ok: false, reason: 'MAX_ITERATIONS', iterations: maxIterations };
}

/**
 * Computes category attribution and repeated-input measurement for one LLM
 * call, never throwing: these are observability extras, not part of the
 * loop's actual behavior, so a bug in either computation must not fail the
 * message being handled (see design.md — Risks, "Measurement changes what
 * is measured"). A failure is logged and that call's fields are simply
 * omitted from the recorded row, mirroring how `SqliteStatsRecorder`
 * already swallows and logs its own write errors.
 */
function measureContextStats(
  requestMessages: ChatMessage[],
  tools: ToolDefinition[],
  previousMessages: ChatMessage[] | undefined,
  usage: TokenUsage | undefined,
): { categoryTokens?: ContextCategoryTokens; repeatedInput?: RepeatedInputTokens } {
  let categoryTokens: ContextCategoryTokens | undefined;
  try {
    if (usage) categoryTokens = categorizeInputTokens(requestMessages, tools, usage.promptTokens);
  } catch (error) {
    logger.warn('Stats: context-category attribution failed, omitting it for this call', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let repeatedInput: RepeatedInputTokens | undefined;
  try {
    repeatedInput = measureRepeatedInput(requestMessages, tools, previousMessages);
  } catch (error) {
    logger.warn('Stats: repeated-input measurement failed, omitting it for this call', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { categoryTokens, repeatedInput };
}

function extractLatestUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messages[i].content;
    }
  }
  return '';
}

export interface OrchestratorDeps {
  client: TelegramReplier;
  provider: string;
  timeoutMs: number;
  sandboxExecutor: SandboxExecutor;
  toolRegistry: ToolRegistry;
  statsRecorder?: StatsRecorder;
  historyStore: HistoryStore;
  maxIterations: number;
  model?: string;
  /** Overridable for tests; defaults to the real process-isolated inference caller. */
  callLlm?: (request: LlmRequest, options: { provider: string; timeoutMs: number }) => Promise<LlmResult>;
  /** When provided, routes each message to a model before running the loop. See `createRouter`. */
  router?: Router;
  /** When provided, its index is included in the system instruction sent with every request. */
  skillLibrary?: SkillLibrary;
  /** Estimated-token size above which a chat's stored conversation is sent compacted rather than in full. Defaults to `DEFAULT_CONVERSATION_COMPACTION_THRESHOLD`. */
  conversationCompactionThreshold?: number;
}

/**
 * Builds a message handler that runs the think → act → observe loop per
 * message. When no tools are registered, the loop exits on iteration 0
 * (one-shot fallback). Each chat's persisted history is loaded before the
 * request and extended after it, so later messages see prior turns.
 */
export function createMessageHandler(deps: OrchestratorDeps) {
  const callLlm = deps.callLlm ?? callLlmIsolated;

  return async function handleMessage(message: TelegramMessage): Promise<void> {
    const chatId = message.chat.id;
    const prompt = message.text ?? '';

    logger.info('Message received', { chatId, prompt });

    if (prompt === NEW_CONVERSATION_COMMAND) {
      deps.historyStore.clearHistory(chatId);
      logger.info('History cleared via /new command', { chatId });
      await deps.client.sendMessage(chatId, NEW_CONVERSATION_REPLY_TEXT);
      return;
    }

    deps.statsRecorder?.recordMessage({
      chatId,
      prompt,
      receivedAt: Date.now(),
    });

    const senderId = message.from?.id;
    const senderName = message.from?.name;

    // Load prior history before persisting this turn, so the just-received
    // message isn't echoed back into its own request.
    const history = deps.historyStore.getHistory(chatId);
    deps.historyStore.appendTurn(chatId, {
      role: 'user',
      content: prompt,
      ...(senderId !== undefined ? { senderId } : {}),
      ...(senderName !== undefined ? { senderName } : {}),
    });

    let deliveryAttempted = false;

    try {
      const prefix = buildRequestPrefix(deps.toolRegistry, deps.skillLibrary);
      const threshold = deps.conversationCompactionThreshold ?? DEFAULT_CONVERSATION_COMPACTION_THRESHOLD;
      const { messages: conversationMessages } = await compactConversation(history.map(renderHistoryTurn), threshold, {
        callLlm,
        provider: deps.provider,
        timeoutMs: deps.timeoutMs,
        ...(deps.statsRecorder ? { statsRecorder: deps.statsRecorder } : {}),
      });
      const messages: ChatMessage[] = [
        { role: 'system', content: prefix.instruction },
        ...conversationMessages,
        { role: 'user', content: renderUserContent(prompt, senderName) },
      ];
      const tools = prefix.tools;

      let model = deps.model;
      if (deps.router) {
        const routeStartedAt = Date.now();
        const decision = await deps.router.route(prompt);
        const routeDurationMs = Date.now() - routeStartedAt;
        model = decision.model;

        deps.statsRecorder?.recordLlmCall({
          iteration: -1,
          role: 'classifier',
          model: decision.classifierModel,
          ok: decision.source === 'classifier',
          durationMs: routeDurationMs,
          calledAt: routeStartedAt,
          ...(decision.classifierUsage ? { usage: decision.classifierUsage } : {}),
        });

        logger.info('Routing decision', { model, source: decision.source, reason: decision.reason });
      }

      const loopDeps: LoopDeps = {
        callLlm,
        provider: deps.provider,
        timeoutMs: deps.timeoutMs,
        sandboxExecutor: deps.sandboxExecutor,
        toolRegistry: deps.toolRegistry,
        ...(deps.statsRecorder ? { statsRecorder: deps.statsRecorder } : {}),
        maxIterations: deps.maxIterations,
        ...(model ? { model } : {}),
      };

      const result = await runLoop(messages, tools, loopDeps);

      const reply = result.ok ? result.text : FAILURE_REPLY_TEXT;

      logger.info(result.ok ? 'Inference succeeded, sending reply' : 'Loop failed, sending failure notice', {
        chatId,
        ...(result.ok ? { reply } : { reason: result.reason }),
        iterations: result.iterations,
      });

      deliveryAttempted = true;
      await deps.client.sendMessage(chatId, reply);

      if (result.ok) {
        deps.historyStore.appendTurn(chatId, { role: 'assistant', content: result.text });
      }

      deps.statsRecorder?.recordMessage({
        chatId,
        ...(result.ok ? { reply } : { reason: result.reason }),
        replySentAt: Date.now(),
        ok: result.ok,
        iterations: result.iterations,
      });
    } catch (error) {
      logger.error('Unexpected error while handling message', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });

      deps.statsRecorder?.recordMessage({
        chatId,
        replySentAt: Date.now(),
        ok: false,
        reason: deliveryAttempted ? 'DELIVERY_FAILED' : 'UNEXPECTED_ERROR',
      });

      try {
        await deps.client.sendMessage(chatId, FAILURE_REPLY_TEXT);
      } catch (sendError) {
        logger.error('Failed to deliver failure notice to chat', {
          chatId,
          error: sendError instanceof Error ? sendError.message : String(sendError),
        });
      }
    }
  };
}
