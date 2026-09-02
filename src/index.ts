import { loadConfig, ConfigError } from './config.js';
import { logger } from './logger.js';
import { registerGlobalErrorHandlers } from './error-handlers.js';
import { TelegramClient } from './telegram/client.js';
import { startPolling } from './telegram/poller.js';
import { createMessageHandler } from './orchestrator.js';
import { createDefaultToolRegistry } from './tools/index.js';
import { DockerSandboxExecutor } from './sandbox/sandbox-executor.js';
import { createStatsRecorder } from './stats/index.js';
import { discoverModels } from './routing/model-discovery.js';
import { createRouter, selectClassifierAndFallback } from './routing/index.js';
import { callLlmIsolated } from './llm/inference-caller.js';

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

  const discoveredModels = await discoverModels(config.ollamaBaseUrl, fetch);
  const router =
    createRouter({
      models: discoveredModels,
      callLlm: (request, options) => callLlmIsolated(request, { provider: config.llmProvider, timeoutMs: options.timeoutMs }),
      ...(config.classifierModel ? { classifierModel: config.classifierModel } : {}),
      ...(config.routerFallbackModel ? { fallbackModel: config.routerFallbackModel } : {}),
      classifierTimeoutMs: config.classifierTimeoutMs,
    }) ?? undefined;

  const handleMessage = createMessageHandler({
    client,
    provider: config.llmProvider,
    timeoutMs: config.llmTimeoutMs,
    sandboxExecutor,
    toolRegistry,
    maxIterations: config.toolUseMaxIterations,
    ...(statsRecorder ? { statsRecorder } : {}),
    ...(router ? { router } : {}),
  });

  logger.info('Bot starting', {
    llmProvider: config.llmProvider,
    sandboxImage: config.sandboxImage,
    maxIterations: config.toolUseMaxIterations,
    statsEnabled: config.statsEnabled,
  });

  logger.info('Model discovery complete', {
    discoveredModels: discoveredModels.map((m) => m.name),
    routingEnabled: router !== undefined,
    ...(discoveredModels.length >= 2
      ? selectClassifierAndFallback(discoveredModels, config.classifierModel || undefined, config.routerFallbackModel || undefined)
      : {}),
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
