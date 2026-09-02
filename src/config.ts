import { KNOWN_PROVIDERS } from './llm/connector-registry.js';

export interface AppConfig {
  telegramBotToken: string;
  llmProvider: string;
  llmTimeoutMs: number;
  ollamaBaseUrl: string;
  sandboxImage: string;
  sandboxTimeoutMs: number;
  sandboxMemoryLimit: string;
  sandboxCpuLimit: string;
  toolUseMaxIterations: number;
  statsDbPath: string;
  statsStorePrompts: boolean;
  statsEnabled: boolean;
  classifierModel: string;
  classifierTimeoutMs: number;
  routerFallbackModel: string;
  maxSubagents: number;
  maxSubIterations: number;
}

export class ConfigError extends Error {}

/** Pure: resolves and validates LLM_PROVIDER without touching the environment or filesystem. */
export function resolveLlmProvider(raw: string | undefined): string {
  const provider = raw ?? 'ollama';
  if (!KNOWN_PROVIDERS.includes(provider)) {
    throw new ConfigError(
      `LLM_PROVIDER "${provider}" is not a registered connector (valid values: ${KNOWN_PROVIDERS.join(', ')})`
    );
  }
  return provider;
}

/** Pure: resolves and validates TELEGRAM_BOT_TOKEN without touching the environment or filesystem. */
export function resolveTelegramBotToken(raw: string | undefined): string {
  if (!raw) {
    throw new ConfigError(
      'TELEGRAM_BOT_TOKEN is required but was not set (add it to .env or the environment)'
    );
  }
  return raw;
}

/** Pure: resolves OLLAMA_BASE_URL with the Docker-network default. */
export function resolveOllamaBaseUrl(raw: string | undefined): string {
  return raw ?? 'http://ollama:11434';
}

/** Pure: resolves SANDBOX_IMAGE. */
export function resolveSandboxImage(raw: string | undefined): string {
  return raw ?? 'telegram-agent-sandbox';
}

/** Pure: resolves SANDBOX_TIMEOUT_MS (must be a positive integer). */
export function resolveSandboxTimeoutMs(raw: string | undefined): number {
  const value = Number(raw ?? 30000);
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new ConfigError(
      `SANDBOX_TIMEOUT_MS must be a positive integer (got "${raw ?? '30000'}")`
    );
  }
  return value;
}

/** Pure: resolves SANDBOX_MEMORY_LIMIT (Docker --memory format, e.g. "256m"). */
export function resolveSandboxMemoryLimit(raw: string | undefined): string {
  return raw ?? '256m';
}

/** Pure: resolves SANDBOX_CPU_LIMIT (Docker --cpus format, e.g. "0.5"). */
export function resolveSandboxCpuLimit(raw: string | undefined): string {
  const value = raw ?? '0.5';
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ConfigError(
      `SANDBOX_CPU_LIMIT must be a positive number (got "${value}")`
    );
  }
  return value;
}

/** Pure: resolves TOOL_USE_MAX_ITERATIONS (must be a positive integer). */
export function resolveToolUseMaxIterations(raw: string | undefined): number {
  const value = Number(raw ?? 5);
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new ConfigError(
      `TOOL_USE_MAX_ITERATIONS must be a positive integer (got "${raw ?? '5'}")`
    );
  }
  return value;
}

/** Pure: resolves STATS_DB_PATH. */
export function resolveStatsDbPath(raw: string | undefined): string {
  return raw ?? 'data/stats.db';
}

/** Pure: parses a "true"/"false" env var (case-insensitive), defaulting when unset. */
function resolveBoolean(raw: string | undefined, envVarName: string, defaultValue: boolean): boolean {
  if (raw === undefined) return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new ConfigError(`${envVarName} must be "true" or "false" (got "${raw}")`);
}

/** Pure: resolves STATS_STORE_PROMPTS (default true). */
export function resolveStatsStorePrompts(raw: string | undefined): boolean {
  return resolveBoolean(raw, 'STATS_STORE_PROMPTS', true);
}

/** Pure: resolves STATS_ENABLED (default true). */
export function resolveStatsEnabled(raw: string | undefined): boolean {
  return resolveBoolean(raw, 'STATS_ENABLED', true);
}

/** Pure: resolves CLASSIFIER_MODEL (empty = auto-select the smallest discovered model). */
export function resolveClassifierModel(raw: string | undefined): string {
  return raw ?? '';
}

/** Pure: resolves CLASSIFIER_TIMEOUT_MS (must be a positive integer). */
export function resolveClassifierTimeoutMs(raw: string | undefined): number {
  const value = Number(raw ?? 5000);
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new ConfigError(
      `CLASSIFIER_TIMEOUT_MS must be a positive integer (got "${raw ?? '5000'}")`
    );
  }
  return value;
}

/** Pure: resolves ROUTER_FALLBACK_MODEL (empty = auto-select the largest tool-capable model). */
export function resolveRouterFallbackModel(raw: string | undefined): string {
  return raw ?? '';
}

/** Pure: resolves MAX_SUBAGENTS (must be a positive integer; caps concurrent spawn_subagents batches). */
export function resolveMaxSubagents(raw: string | undefined): number {
  const value = Number(raw ?? 3);
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new ConfigError(
      `MAX_SUBAGENTS must be a positive integer (got "${raw ?? '3'}")`
    );
  }
  return value;
}

/** Pure: resolves MAX_SUB_ITERATIONS (must be a positive integer; caps a sub-agent's own loop). */
export function resolveMaxSubIterations(raw: string | undefined): number {
  const value = Number(raw ?? 3);
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new ConfigError(
      `MAX_SUB_ITERATIONS must be a positive integer (got "${raw ?? '3'}")`
    );
  }
  return value;
}

export function loadConfig(): AppConfig {
  try {
    process.loadEnvFile();
  } catch {
    // .env is optional - environment variables may be supplied directly.
  }

  return {
    telegramBotToken: resolveTelegramBotToken(process.env.TELEGRAM_BOT_TOKEN),
    llmProvider: resolveLlmProvider(process.env.LLM_PROVIDER),
    llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 15000),
    ollamaBaseUrl: resolveOllamaBaseUrl(process.env.OLLAMA_BASE_URL),
    sandboxImage: resolveSandboxImage(process.env.SANDBOX_IMAGE),
    sandboxTimeoutMs: resolveSandboxTimeoutMs(process.env.SANDBOX_TIMEOUT_MS),
    sandboxMemoryLimit: resolveSandboxMemoryLimit(process.env.SANDBOX_MEMORY_LIMIT),
    sandboxCpuLimit: resolveSandboxCpuLimit(process.env.SANDBOX_CPU_LIMIT),
    toolUseMaxIterations: resolveToolUseMaxIterations(process.env.TOOL_USE_MAX_ITERATIONS),
    statsDbPath: resolveStatsDbPath(process.env.STATS_DB_PATH),
    statsStorePrompts: resolveStatsStorePrompts(process.env.STATS_STORE_PROMPTS),
    statsEnabled: resolveStatsEnabled(process.env.STATS_ENABLED),
    classifierModel: resolveClassifierModel(process.env.CLASSIFIER_MODEL),
    classifierTimeoutMs: resolveClassifierTimeoutMs(process.env.CLASSIFIER_TIMEOUT_MS),
    routerFallbackModel: resolveRouterFallbackModel(process.env.ROUTER_FALLBACK_MODEL),
    maxSubagents: resolveMaxSubagents(process.env.MAX_SUBAGENTS),
    maxSubIterations: resolveMaxSubIterations(process.env.MAX_SUB_ITERATIONS),
  };
}
