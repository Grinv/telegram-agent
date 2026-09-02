import { callLlmIsolated } from './llm/inference-caller.js';
import { FAILURE_LABELS } from './llm/failure-labels.js';
import type {
  ChatMessage,
  LlmRequest,
  LlmResult,
  ToolCall,
  ToolDefinition,
} from './llm/types.js';
import type { StatsRecorder } from './stats/types.js';
import type { SandboxExecutor } from './sandbox/sandbox-executor.js';
import type { ToolRegistry } from './tools/registry.js';
import { logger } from './logger.js';
import type { TelegramMessage, TelegramReplier } from './telegram/client.js';
import type { Router } from './routing/types.js';

const FAILURE_REPLY_TEXT = 'Sorry, I could not process your message right now. Please try again later.';

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
  const { callLlm, provider, timeoutMs, sandboxExecutor, toolRegistry, statsRecorder, maxIterations, model, role } = deps;

  for (let i = 0; i < maxIterations; i++) {
    const request: LlmRequest = {
      prompt: extractLatestUserText(messages),
      messages,
      ...(tools.length > 0 ? { tools } : {}),
      ...(model ? { model } : {}),
    };

    const startedAt = Date.now();
    const result = await callLlm(request, { provider, timeoutMs });
    const durationMs = Date.now() - startedAt;

    statsRecorder?.recordLlmCall({
      iteration: i,
      ...(role ? { role } : {}),
      ...(model ? { model } : {}),
      ok: result.ok,
      ...(result.ok ? { text: result.text, ...(result.toolCalls ? { toolCalls: result.toolCalls } : {}) } : {}),
      ...(result.ok && result.usage ? { usage: result.usage } : {}),
      durationMs,
    });

    if (!result.ok) {
      logger.error(FAILURE_LABELS[result.reason], { reason: result.reason, detail: result.message });
      return { ok: false, reason: result.reason, iterations: i + 1 };
    }

    if (!result.toolCalls || result.toolCalls.length === 0) {
      return { ok: true, text: result.text, iterations: i + 1 };
    }

    const observations = await sandboxExecutor.execute(result.toolCalls, toolRegistry);

    statsRecorder?.recordToolCall({
      iteration: i,
      toolCalls: result.toolCalls,
      results: observations,
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
  maxIterations: number;
  model?: string;
  /** Overridable for tests; defaults to the real process-isolated inference caller. */
  callLlm?: (request: LlmRequest, options: { provider: string; timeoutMs: number }) => Promise<LlmResult>;
  /** When provided, routes each message to a model before running the loop. See `createRouter`. */
  router?: Router;
}

/**
 * Builds a message handler that runs the think → act → observe loop per
 * message. When no tools are registered, the loop exits on iteration 0
 * (one-shot fallback). No per-chat state is kept between messages.
 */
export function createMessageHandler(deps: OrchestratorDeps) {
  const callLlm = deps.callLlm ?? callLlmIsolated;

  return async function handleMessage(message: TelegramMessage): Promise<void> {
    const chatId = message.chat.id;
    const prompt = message.text ?? '';

    logger.info('Message received', { chatId, prompt });

    deps.statsRecorder?.recordMessage({
      chatId,
      prompt,
      receivedAt: Date.now(),
    });

    let deliveryAttempted = false;

    try {
      const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
      const tools = deps.toolRegistry.isEmpty() ? [] : deps.toolRegistry.getDefinitions();

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
