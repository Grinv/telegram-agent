import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStatsRecorder } from '../../src/stats/sqlite-recorder.js';
import type { ContextCategoryTokens } from '../../src/stats/context-categories.js';
import type { RepeatedInputTokens } from '../../src/stats/repeated-input.js';

export function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stats-dashboard-test-'));
  return join(dir, 'stats.db');
}

/** Waits for the fire-and-forget write microtask queued by a record* call to flush. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const PRICE_TABLE = { modelA: { inputPerMillion: 2, outputPerMillion: 4 } };

function cat(
  instructionTokens: number,
  userRequestTokens: number,
  conversationTokens: number,
  toolOutputTokens: number,
  toolDefinitionTokens: number
): ContextCategoryTokens {
  return { instructionTokens, userRequestTokens, conversationTokens, toolOutputTokens, toolDefinitionTokens };
}

function rep(repeatedTokens: number, newTokens: number): RepeatedInputTokens {
  return { repeatedTokens, newTokens };
}

export interface DashboardFixture {
  dbPath: string;
  task1Id: number;
  task2Id: number;
  expected: {
    taskCount: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    cacheHitRate: number;
    estimatedCost: number;
    avgTokensPerTask: number;
    avgTurnsPerTask: number;
    avgToolCallsPerTask: number;
    toolShares: { search: number; write: number };
    mostExpensiveTurn: { turnNumber: number; model: string; inputTokens: number };
    categoryTotals: {
      instructionTokens: number;
      userRequestTokens: number;
      conversationTokens: number;
      toolOutputTokens: number;
      toolDefinitionTokens: number;
    };
    repeatedVsNew: { repeatedTokens: number; newTokens: number };
  };
}

/**
 * Builds a temporary stats database via `SqliteStatsRecorder` (so rows go through the same
 * path production writes take) holding two tasks: task 1 runs two turns on a priced model
 * (`modelA`) with mixed tool calls and one turn whose provider never reported cache stats;
 * task 2 runs one turn on an unpriced model (`modelB`) whose provider did report cache stats.
 * `expected` holds every figure computed by hand from these rows, for exact-value assertions.
 */
export async function buildDashboardFixture(): Promise<DashboardFixture> {
  const dbPath = tmpDbPath();
  const recorder = new SqliteStatsRecorder(dbPath, true, PRICE_TABLE);

  // --- Task 1 (chat 1): two turns on a priced model ---
  recorder.recordMessage({ chatId: 1, prompt: 'task one', receivedAt: 0 });
  await flush();

  recorder.recordLlmCall({
    iteration: 0,
    model: 'modelA',
    ok: true,
    text: 'a',
    usage: { promptTokens: 100, completionTokens: 50, cachedTokens: 20 },
    calledAt: 1000,
    categoryTokens: cat(10, 20, 30, 20, 20),
    repeatedInput: rep(0, 100),
  });
  await flush();
  recorder.recordToolCall({
    iteration: 0,
    toolCalls: [{ name: 'search', arguments: {} }],
    results: [{ ok: true, output: 'a'.repeat(40) }],
    durationMs: 10,
  });
  await flush();

  recorder.recordLlmCall({
    iteration: 1,
    model: 'modelA',
    ok: true,
    text: 'b',
    usage: { promptTokens: 200, completionTokens: 80 }, // no cachedTokens: provider never reported cache stats for this call
    calledAt: 2000,
    categoryTokens: cat(20, 0, 80, 60, 40),
    repeatedInput: rep(100, 100),
  });
  await flush();
  recorder.recordToolCall({
    iteration: 1,
    toolCalls: [
      { name: 'search', arguments: {} },
      { name: 'write', arguments: {} },
    ],
    results: [
      { ok: true, output: 'b'.repeat(80) },
      { ok: true, output: 'c'.repeat(20) },
    ],
    durationMs: 15,
  });
  await flush();

  recorder.recordMessage({ chatId: 1, reply: 'done', replySentAt: 3000, ok: true, iterations: 2 });
  await flush();

  // --- Task 2 (chat 2): one turn on an unpriced model ---
  recorder.recordMessage({ chatId: 2, prompt: 'task two', receivedAt: 4000 });
  await flush();

  recorder.recordLlmCall({
    iteration: 0,
    model: 'modelB',
    ok: true,
    text: 'c',
    usage: { promptTokens: 150, completionTokens: 60, cachedTokens: 30 },
    calledAt: 5000,
    categoryTokens: cat(5, 40, 50, 40, 15),
    repeatedInput: rep(0, 150),
  });
  await flush();
  recorder.recordToolCall({
    iteration: 0,
    toolCalls: [{ name: 'write', arguments: {} }],
    results: [{ ok: true, output: 'd'.repeat(60) }],
    durationMs: 12,
  });
  await flush();

  recorder.recordMessage({ chatId: 2, reply: 'done', replySentAt: 5500, ok: true, iterations: 1 });
  await flush();

  const db = new DatabaseSync(dbPath);
  const ids = db.prepare('SELECT id, chat_id FROM messages ORDER BY id ASC').all() as Array<{ id: number; chat_id: number }>;
  db.close();
  const task1Id = ids.find((r) => r.chat_id === 1)!.id;
  const task2Id = ids.find((r) => r.chat_id === 2)!.id;

  return {
    dbPath,
    task1Id,
    task2Id,
    expected: {
      taskCount: 2,
      inputTokens: 450,
      outputTokens: 190,
      cachedTokens: 50,
      cacheHitRate: 0.2, // (20 + 30) cached / (100 + 150) input, over the two calls that reported cache stats
      estimatedCost: 0.00112, // modelA calls only: (100*2 + 50*4)/1e6 + (200*2 + 80*4)/1e6; modelB is unpriced
      avgTokensPerTask: 320, // (450 + 190) / 2 tasks
      avgTurnsPerTask: 1.5, // 3 llm calls / 2 tasks
      avgToolCallsPerTask: 2, // 4 tool calls / 2 tasks
      toolShares: { search: 0.6, write: 0.4 }, // search: 10+20=30 tokens, write: 5+15=20 tokens, total 50
      mostExpensiveTurn: { turnNumber: 1, model: 'modelA', inputTokens: 200 },
      categoryTotals: {
        instructionTokens: 35,
        userRequestTokens: 60,
        conversationTokens: 160,
        toolOutputTokens: 120,
        toolDefinitionTokens: 75,
      },
      repeatedVsNew: { repeatedTokens: 100, newTokens: 350 },
    },
  };
}
