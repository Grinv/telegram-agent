import { loadConfig, ConfigError } from './config.js';
import { logger } from './logger.js';
import { registerGlobalErrorHandlers } from './error-handlers.js';
import { TelegramClient } from './telegram/client.js';
import { startPolling } from './telegram/poller.js';
import { createMessageHandler } from './orchestrator.js';
import { createDefaultToolRegistry } from './tools/index.js';
import { DockerSandboxExecutor } from './sandbox/sandbox-executor.js';
import { createStatsRecorder } from './stats/index.js';

registerGlobalErrorHandlers();

try {
  const config = loadConfig();
  const client = new TelegramClient(config.telegramBotToken);
  const toolRegistry = createDefaultToolRegistry();
  const sandboxExecutor = new DockerSandboxExecutor({
    image: config.sandboxImage,
    timeoutMs: config.sandboxTimeoutMs,
    memoryLimit: config.sandboxMemoryLimit,
    cpuLimit: config.sandboxCpuLimit,
  });

  const statsRecorder = config.statsEnabled
    ? createStatsRecorder(config.statsDbPath, config.statsStorePrompts)
    : undefined;

  const handleMessage = createMessageHandler({
    client,
    provider: config.llmProvider,
    timeoutMs: config.llmTimeoutMs,
    sandboxExecutor,
    toolRegistry,
    maxIterations: config.toolUseMaxIterations,
    ...(statsRecorder ? { statsRecorder } : {}),
  });

  logger.info('Bot starting', {
    llmProvider: config.llmProvider,
    sandboxImage: config.sandboxImage,
    maxIterations: config.toolUseMaxIterations,
    statsEnabled: config.statsEnabled,
  });

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
