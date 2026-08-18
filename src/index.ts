import { loadConfig, ConfigError } from './config.js';
import { logger } from './logger.js';
import { registerGlobalErrorHandlers } from './error-handlers.js';
import { TelegramClient } from './telegram/client.js';
import { startPolling } from './telegram/poller.js';
import { createMessageHandler } from './orchestrator.js';

registerGlobalErrorHandlers();

try {
  const config = loadConfig();
  const client = new TelegramClient(config.telegramBotToken);
  const handleMessage = createMessageHandler({
    client,
    provider: config.llmProvider,
    timeoutMs: config.llmTimeoutMs,
  });

  logger.info('Bot starting', { llmProvider: config.llmProvider });

  await startPolling(client, (message) => {
    void handleMessage(message);
  });
} catch (error) {
  if (error instanceof ConfigError) {
    logger.error('Startup configuration error', { message: error.message });
    process.exitCode = 1;
  } else {
    throw error;
  }
}
