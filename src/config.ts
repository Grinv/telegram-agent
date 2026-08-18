import { KNOWN_PROVIDERS } from './llm/connector-registry.js';

export interface AppConfig {
  telegramBotToken: string;
  llmProvider: string;
  llmTimeoutMs: number;
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

export function loadConfig(): AppConfig {
  try {
    process.loadEnvFile();
  } catch {
    // .env is optional - environment variables may be supplied directly.
  }

  const telegramBotToken = resolveTelegramBotToken(process.env.TELEGRAM_BOT_TOKEN);
  const llmProvider = resolveLlmProvider(process.env.LLM_PROVIDER);
  const llmTimeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 15000);

  return { telegramBotToken, llmProvider, llmTimeoutMs };
}
