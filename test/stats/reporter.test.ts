import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStatsRecorder } from '../../src/stats/sqlite-recorder.js';
import { StatsReporter } from '../../src/stats/reporter.js';

async function tmpPaths(): Promise<{ dbPath: string; outputPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'stats-report-test-'));
  return { dbPath: join(dir, 'stats.db'), outputPath: join(dir, 'report.md') };
}

test('generateReport renders model names, token counts, and table headers', async () => {
  const { dbPath, outputPath } = await tmpPaths();
  const recorder = new SqliteStatsRecorder(dbPath, true);

  recorder.recordMessage({ chatId: 1, prompt: 'hi', receivedAt: 0 });
  recorder.recordLlmCall({
    iteration: 0,
    model: 'llama3',
    ok: true,
    text: 'hi there',
    usage: { promptTokens: 10, completionTokens: 5 },
    durationMs: 100,
  });
  recorder.recordToolCall({
    iteration: 0,
    toolCalls: [{ name: 'search', arguments: {} }],
    results: [{ ok: true, output: 'result' }],
    durationMs: 20,
  });
  recorder.recordMessage({ chatId: 1, reply: 'hi there', replySentAt: 150, ok: true, iterations: 1 });

  const reporter = new StatsReporter(dbPath);
  await reporter.generateReport(outputPath);

  const report = await readFile(outputPath, 'utf8');

  assert.match(report, /## Per-model token totals/);
  assert.match(report, /llama3/);
  assert.match(report, /\| Model \| Input tokens \| Output tokens \| Total tokens \| Calls \|/);
  assert.match(report, /\| llama3 \| 10 \| 5 \| 15 \| 1 \|/);
  assert.match(report, /## Per-role token breakdown/);
  assert.match(report, /main/);
  assert.match(report, /## Latency per model/);
  assert.match(report, /## Success rate/);
  assert.match(report, /\| 1 \| 1 \| 100 \|/);
  assert.match(report, /## Tool usage/);
  assert.match(report, /search/);
});

test('generateReport writes a "No data" message for an empty database', async () => {
  const { dbPath, outputPath } = await tmpPaths();

  const reporter = new StatsReporter(dbPath);
  await reporter.generateReport(outputPath);

  const report = await readFile(outputPath, 'utf8');
  assert.match(report, /No data/);
});
