import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, resolveLlmProvider, resolveTelegramBotToken, ConfigError } from '../src/config.js';

// resolveTelegramBotToken and resolveLlmProvider are pure (no env/filesystem access),
// so these run hermetically regardless of what's in the real local .env - unlike
// loadConfig() itself, which re-reads .env on every call and would silently refill
// a deleted process.env var from disk.
test('resolveTelegramBotToken throws ConfigError when the token is missing', () => {
  assert.throws(() => resolveTelegramBotToken(undefined), ConfigError);
  assert.throws(() => resolveTelegramBotToken(''), ConfigError);
});

test('resolveTelegramBotToken returns the token when present', () => {
  assert.equal(resolveTelegramBotToken('test-token'), 'test-token');
});

test('parses LLM_TIMEOUT_MS when set', () => {
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalTimeout = process.env.LLM_TIMEOUT_MS;

  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.LLM_TIMEOUT_MS = '5000';

  try {
    const config = loadConfig();
    assert.equal(config.telegramBotToken, 'test-token');
    assert.equal(config.llmTimeoutMs, 5000);
  } finally {
    if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = originalToken;
    if (originalTimeout === undefined) delete process.env.LLM_TIMEOUT_MS;
    else process.env.LLM_TIMEOUT_MS = originalTimeout;
  }
});

test('resolveLlmProvider defaults to "ollama" when unset', () => {
  assert.equal(resolveLlmProvider(undefined), 'ollama');
});

test('resolveLlmProvider accepts known provider names', () => {
  assert.equal(resolveLlmProvider('stub'), 'stub');
  assert.equal(resolveLlmProvider('ollama'), 'ollama');
});

test('resolveLlmProvider throws ConfigError for an unrecognized value', () => {
  assert.throws(() => resolveLlmProvider('tinyllama'), ConfigError);
});
