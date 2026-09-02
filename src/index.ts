import { loadConfig, ConfigError } from './config.js';
import { logger } from './logger.js';
import { registerGlobalErrorHandlers } from './error-handlers.js';
import { TelegramClient } from './telegram/client.js';
import { startPolling } from './telegram/poller.js';
import { createMessageHandler, runLoop } from './orchestrator.js';
import { createSubagentToolRegistry } from './tools/index.js';
import type { ToolContext } from './tools/index.js';
import { DockerSandboxExecutor } from './sandbox/sandbox-executor.js';
import { createStatsRecorder } from './stats/index.js';
import { discoverModels } from './routing/model-discovery.js';
import { createRouter, selectClassifierAndFallback } from './routing/index.js';
import { callLlmIsolated } from './llm/inference-caller.js';

registerGlobalErrorHandlers();

try {
  const config = loadConfig();
  const client = new TelegramClient(config.telegramBotToken, fetch, config.telegramApiBaseUrl);

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

  // Context merged into every tool call by the sandbox executor (see below),
  // so tools that start nested loops (spawn_subagent/spawn_subagents) have
  // what they need. `sandboxExecutor` is filled in below once constructed,
  // since it needs to reference itself; `extraContext` is stored by
  // reference, so that late assignment is picked up on every tool call.
  const extraContext: Partial<ToolContext> = {
    callLlm: (request, options) => callLlmIsolated(request, { provider: config.llmProvider, timeoutMs: options.timeoutMs }),
    provider: config.llmProvider,
    timeoutMs: config.llmTimeoutMs,
    runLoop,
    ...(statsRecorder ? { statsRecorder } : {}),
    ...(router ? { router } : {}),
    maxSubagents: config.maxSubagents,
    maxSubIterations: config.maxSubIterations,
  };

  const toolRegistry = createSubagentToolRegistry({ execInContainer: async () => {
    throw new Error('execInContainer is only available inside a sandbox call');
  }, ...extraContext });
  extraContext.toolRegistry = toolRegistry;

  const sandboxExecutor = new DockerSandboxExecutor(
    {
      image: config.sandboxImage,
      timeoutMs: config.sandboxTimeoutMs,
      memoryLimit: config.sandboxMemoryLimit,
      cpuLimit: config.sandboxCpuLimit,
    },
    undefined,
    extraContext,
  );
  extraContext.sandboxExecutor = sandboxExecutor;

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
