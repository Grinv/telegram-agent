import { callLlmIsolated } from './llm/inference-caller.js';
import { FAILURE_LABELS } from './llm/failure-labels.js';
import type { LlmResult } from './llm/types.js';
import { logger } from './logger.js';
import type { TelegramMessage, TelegramReplier } from './telegram/client.js';

const FAILURE_REPLY_TEXT = 'Sorry, I could not process your message right now. Please try again later.';

type CallLlm = (prompt: string, options: { provider: string; timeoutMs: number }) => Promise<LlmResult>;

export interface OrchestratorDeps {
  client: TelegramReplier;
  provider: string;
  timeoutMs: number;
  /** Overridable for tests; defaults to the real process-isolated inference caller. */
  callLlm?: CallLlm;
}

/**
 * Builds a one-shot message handler: it holds no per-chat state, so every call
 * only ever sees the message passed to it (see bot-orchestrator spec - one-shot handling).
 */
export function createMessageHandler(deps: OrchestratorDeps) {
  const callLlm = deps.callLlm ?? callLlmIsolated;

  return async function handleMessage(message: TelegramMessage): Promise<void> {
    const chatId = message.chat.id;
    const prompt = message.text ?? '';

    logger.info('Message received', { chatId, prompt });

    try {
      const result = await callLlm(prompt, { provider: deps.provider, timeoutMs: deps.timeoutMs });

      if (result.ok) {
        logger.info('Inference succeeded, sending reply', { chatId, reply: result.text });
        await deps.client.sendMessage(chatId, result.text);
        return;
      }

      logger.error(FAILURE_LABELS[result.reason], { chatId, reason: result.reason, detail: result.message });
      await deps.client.sendMessage(chatId, FAILURE_REPLY_TEXT);
    } catch (error) {
      logger.error('Unexpected error while handling message', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
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
