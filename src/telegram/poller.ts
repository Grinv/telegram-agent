import { logger } from '../logger.js';
import type { TelegramClient, TelegramMessage, TelegramUpdate } from './client.js';

export interface PollerOptions {
  pollTimeoutSeconds?: number;
  retryDelayMs?: number;
}

const DEFAULT_POLL_TIMEOUT_SECONDS = 30;
const DEFAULT_RETRY_DELAY_MS = 2000;

/** Returns the update's text message, or undefined for update types we don't handle (stickers, edits, ...). */
export function extractTextMessage(update: TelegramUpdate): TelegramMessage | undefined {
  return update.message?.text !== undefined ? update.message : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startPolling(
  client: TelegramClient,
  onMessage: (message: TelegramMessage) => void,
  options: PollerOptions = {},
  signal?: AbortSignal
): Promise<void> {
  const pollTimeoutSeconds = options.pollTimeoutSeconds ?? DEFAULT_POLL_TIMEOUT_SECONDS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  let offset: number | undefined;

  while (!signal?.aborted) {
    try {
      const updates = await client.getUpdates(offset, pollTimeoutSeconds);
      for (const update of updates) {
        offset = update.update_id + 1;
        const message = extractTextMessage(update);
        if (message) {
          onMessage(message);
        }
      }
    } catch (error) {
      logger.warn('Telegram polling error, retrying', {
        error: error instanceof Error ? error.message : String(error),
      });
      await delay(retryDelayMs);
    }
  }
}
