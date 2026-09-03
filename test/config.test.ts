import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadConfig,
  resolveLlmProvider,
  resolveTelegramBotToken,
  resolveOllamaBaseUrl,
  resolveTelegramApiBaseUrl,
  resolveSandboxImage,
  resolveSandboxTimeoutMs,
  resolveSandboxMemoryLimit,
  resolveSandboxCpuLimit,
  resolveSandboxNetwork,
  resolveSandboxNetworkName,
  resolveToolUseMaxIterations,
  resolveStatsDbPath,
  resolveStatsStorePrompts,
  resolveStatsEnabled,
  resolveClassifierModel,
  resolveClassifierTimeoutMs,
  resolveRouterFallbackModel,
  resolveMaxSubagents,
  resolveMaxSubIterations,
  resolveSkillsDir,
  ConfigError,
} from '../src/config.js';

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

// --- New sandbox config resolvers ---

test('resolveOllamaBaseUrl defaults to http://ollama:11434', () => {
  assert.equal(resolveOllamaBaseUrl(undefined), 'http://ollama:11434');
});

test('resolveOllamaBaseUrl returns the provided value', () => {
  assert.equal(resolveOllamaBaseUrl('http://127.0.0.1:11434'), 'http://127.0.0.1:11434');
});

test('resolveTelegramApiBaseUrl defaults to https://api.telegram.org', () => {
  assert.equal(resolveTelegramApiBaseUrl(undefined), 'https://api.telegram.org');
});

test('resolveTelegramApiBaseUrl returns the provided value', () => {
  assert.equal(resolveTelegramApiBaseUrl('http://127.0.0.1:8081'), 'http://127.0.0.1:8081');
});

test('resolveTelegramApiBaseUrl strips a trailing slash', () => {
  assert.equal(resolveTelegramApiBaseUrl('http://127.0.0.1:8081/'), 'http://127.0.0.1:8081');
});

test('resolveTelegramApiBaseUrl throws ConfigError for an invalid URL', () => {
  assert.throws(() => resolveTelegramApiBaseUrl('not a url'), ConfigError);
});

test('resolveSandboxImage defaults to telegram-agent-sandbox', () => {
  assert.equal(resolveSandboxImage(undefined), 'telegram-agent-sandbox');
});

test('resolveSandboxImage returns the provided value', () => {
  assert.equal(resolveSandboxImage('custom-sandbox'), 'custom-sandbox');
});

test('resolveSandboxTimeoutMs defaults to 30000', () => {
  assert.equal(resolveSandboxTimeoutMs(undefined), 30000);
});

test('resolveSandboxTimeoutMs returns the provided value', () => {
  assert.equal(resolveSandboxTimeoutMs('60000'), 60000);
});

test('resolveSandboxTimeoutMs throws ConfigError for non-positive or non-integer values', () => {
  assert.throws(() => resolveSandboxTimeoutMs('0'), ConfigError);
  assert.throws(() => resolveSandboxTimeoutMs('-1'), ConfigError);
  assert.throws(() => resolveSandboxTimeoutMs('abc'), ConfigError);
  assert.throws(() => resolveSandboxTimeoutMs('1.5'), ConfigError);
});

test('resolveSandboxMemoryLimit defaults to 256m', () => {
  assert.equal(resolveSandboxMemoryLimit(undefined), '256m');
});

test('resolveSandboxMemoryLimit returns the provided value', () => {
  assert.equal(resolveSandboxMemoryLimit('512m'), '512m');
});

test('resolveSandboxCpuLimit defaults to 0.5', () => {
  assert.equal(resolveSandboxCpuLimit(undefined), '0.5');
});

test('resolveSandboxCpuLimit returns the provided value', () => {
  assert.equal(resolveSandboxCpuLimit('1.0'), '1.0');
});

test('resolveSandboxCpuLimit throws ConfigError for non-positive values', () => {
  assert.throws(() => resolveSandboxCpuLimit('0'), ConfigError);
  assert.throws(() => resolveSandboxCpuLimit('-1'), ConfigError);
  assert.throws(() => resolveSandboxCpuLimit('abc'), ConfigError);
});

test('resolveSandboxNetwork defaults to isolated', () => {
  assert.equal(resolveSandboxNetwork(undefined), 'isolated');
});

test('resolveSandboxNetwork accepts each explicit valid value', () => {
  assert.equal(resolveSandboxNetwork('isolated'), 'isolated');
  assert.equal(resolveSandboxNetwork('egress'), 'egress');
});

test('resolveSandboxNetwork throws ConfigError for an unrecognized value', () => {
  assert.throws(() => resolveSandboxNetwork('bridge'), ConfigError);
});

test('resolveSandboxNetworkName defaults to telegram-agent-sandbox-net', () => {
  assert.equal(resolveSandboxNetworkName(undefined), 'telegram-agent-sandbox-net');
});

test('resolveSandboxNetworkName returns the provided value', () => {
  assert.equal(resolveSandboxNetworkName('custom-net'), 'custom-net');
});

test('resolveToolUseMaxIterations defaults to 5', () => {
  assert.equal(resolveToolUseMaxIterations(undefined), 5);
});

test('resolveToolUseMaxIterations returns the provided value', () => {
  assert.equal(resolveToolUseMaxIterations('10'), 10);
});

test('resolveToolUseMaxIterations throws ConfigError for non-positive or non-integer values', () => {
  assert.throws(() => resolveToolUseMaxIterations('0'), ConfigError);
  assert.throws(() => resolveToolUseMaxIterations('-1'), ConfigError);
  assert.throws(() => resolveToolUseMaxIterations('abc'), ConfigError);
  assert.throws(() => resolveToolUseMaxIterations('2.5'), ConfigError);
});

// --- Stats config resolvers ---

test('resolveStatsDbPath defaults to data/stats.db', () => {
  assert.equal(resolveStatsDbPath(undefined), 'data/stats.db');
});

test('resolveStatsDbPath returns the provided value', () => {
  assert.equal(resolveStatsDbPath('/tmp/custom.db'), '/tmp/custom.db');
});

test('resolveStatsStorePrompts defaults to true', () => {
  assert.equal(resolveStatsStorePrompts(undefined), true);
});

test('resolveStatsStorePrompts parses "true" and "false" case-insensitively', () => {
  assert.equal(resolveStatsStorePrompts('true'), true);
  assert.equal(resolveStatsStorePrompts('FALSE'), false);
});

test('resolveStatsStorePrompts throws ConfigError for an invalid value', () => {
  assert.throws(() => resolveStatsStorePrompts('yes'), ConfigError);
});

test('resolveStatsEnabled defaults to true', () => {
  assert.equal(resolveStatsEnabled(undefined), true);
});

test('resolveStatsEnabled parses "true" and "false" case-insensitively', () => {
  assert.equal(resolveStatsEnabled('true'), true);
  assert.equal(resolveStatsEnabled('False'), false);
});

test('resolveStatsEnabled throws ConfigError for an invalid value', () => {
  assert.throws(() => resolveStatsEnabled('nope'), ConfigError);
});

// --- Model routing config resolvers ---

test('resolveClassifierModel defaults to empty string (auto-select) when unset', () => {
  assert.equal(resolveClassifierModel(undefined), '');
});

test('resolveClassifierModel returns the provided value', () => {
  assert.equal(resolveClassifierModel('llama3.1:8b'), 'llama3.1:8b');
});

test('resolveClassifierTimeoutMs defaults to 5000', () => {
  assert.equal(resolveClassifierTimeoutMs(undefined), 5000);
});

test('resolveClassifierTimeoutMs returns the provided value', () => {
  assert.equal(resolveClassifierTimeoutMs('2000'), 2000);
});

test('resolveClassifierTimeoutMs throws ConfigError for non-positive or non-integer values', () => {
  assert.throws(() => resolveClassifierTimeoutMs('0'), ConfigError);
  assert.throws(() => resolveClassifierTimeoutMs('-1'), ConfigError);
  assert.throws(() => resolveClassifierTimeoutMs('abc'), ConfigError);
  assert.throws(() => resolveClassifierTimeoutMs('1.5'), ConfigError);
});

test('resolveRouterFallbackModel defaults to empty string (auto-select) when unset', () => {
  assert.equal(resolveRouterFallbackModel(undefined), '');
});

test('resolveRouterFallbackModel returns the provided value', () => {
  assert.equal(resolveRouterFallbackModel('mistral-nemo'), 'mistral-nemo');
});

// --- Subagent config resolvers ---

test('resolveMaxSubagents defaults to 3', () => {
  assert.equal(resolveMaxSubagents(undefined), 3);
});

test('resolveMaxSubagents returns the provided value', () => {
  assert.equal(resolveMaxSubagents('5'), 5);
});

test('resolveMaxSubagents throws ConfigError for non-positive or non-integer values', () => {
  assert.throws(() => resolveMaxSubagents('0'), ConfigError);
  assert.throws(() => resolveMaxSubagents('-1'), ConfigError);
  assert.throws(() => resolveMaxSubagents('abc'), ConfigError);
  assert.throws(() => resolveMaxSubagents('2.5'), ConfigError);
});

test('resolveMaxSubIterations defaults to 3', () => {
  assert.equal(resolveMaxSubIterations(undefined), 3);
});

test('resolveMaxSubIterations returns the provided value', () => {
  assert.equal(resolveMaxSubIterations('2'), 2);
});

test('resolveMaxSubIterations throws ConfigError for non-positive or non-integer values', () => {
  assert.throws(() => resolveMaxSubIterations('0'), ConfigError);
  assert.throws(() => resolveMaxSubIterations('-1'), ConfigError);
  assert.throws(() => resolveMaxSubIterations('abc'), ConfigError);
  assert.throws(() => resolveMaxSubIterations('1.5'), ConfigError);
});

// --- Skills config resolver ---

test('resolveSkillsDir defaults to "skills"', () => {
  assert.equal(resolveSkillsDir(undefined), 'skills');
});

test('resolveSkillsDir returns the provided value', () => {
  assert.equal(resolveSkillsDir('custom-skills-dir'), 'custom-skills-dir');
});
