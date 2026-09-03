import type { TelegramReplier } from '../src/telegram/client.js';

/**
 * A `TelegramReplier` that records every reply sent to it instead of calling
 * the real Telegram API. This is what lets the runner drive the real message
 * handler and still get the reply text back for the task's correctness
 * check (see design.md — "Drive the agent through its own handler").
 */
export function createCapturingReplier(): { replier: TelegramReplier; replies: string[] } {
  const replies: string[] = [];
  const replier: TelegramReplier = {
    async sendMessage(_chatId: number, text: string): Promise<void> {
      replies.push(text);
    },
  };
  return { replier, replies };
}
