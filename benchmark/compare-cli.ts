import { mkdir, writeFile } from 'node:fs/promises';
import { logger } from '../src/logger.js';
import { readSnapshot, snapshotPath } from './snapshot.js';
import { compareSnapshots } from './compare.js';
import type { ComparisonResult } from './compare.js';

const [beforeLabel, afterLabel] = process.argv.slice(2);
if (!beforeLabel || !afterLabel) {
  logger.error('Benchmark compare: expected two snapshot labels, e.g. `npm run benchmark:compare -- baseline after-optimization`');
  process.exit(1);
}

const snapshotDir = process.env.BENCHMARK_SNAPSHOT_DIR || 'data/benchmark-snapshots';
const beforePath = snapshotPath(snapshotDir, beforeLabel);
const afterPath = snapshotPath(snapshotDir, afterLabel);

const before = await readSnapshot(beforePath);
const after = await readSnapshot(afterPath);

const outcome = compareSnapshots(before, after);

if (!outcome.comparable) {
  logger.error('Benchmark compare: snapshots are not comparable', { reason: outcome.reason, beforeLabel, afterLabel });
  process.exit(1);
}

const outputPath = `data/benchmark-compare-${sanitize(beforeLabel)}-vs-${sanitize(afterLabel)}.md`;
await mkdir('data', { recursive: true });
await writeFile(outputPath, renderComparison(outcome), 'utf8');

logger.info('Benchmark compare complete', {
  outputPath,
  tokensDelta: outcome.overall.tokens.delta,
  costDelta: outcome.overall.cost.delta,
  correctnessRateDelta: outcome.overall.correctnessRate.delta,
  regressedTasks: outcome.regressedTasks,
});

function sanitize(label: string): string {
  return label.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function formatPercent(value: number | null): string {
  if (value === null) return 'n/a';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

function formatDelta(value: number, digits = 0): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function renderComparison(result: ComparisonResult): string {
  const lines: string[] = [];
  lines.push('# Benchmark Comparison', '');
  lines.push(`Before: **${result.before.label}** (model \`${result.before.model}\`)`);
  lines.push(`After: **${result.after.label}** (model \`${result.after.model}\`)`, '');

  lines.push('## Overall', '');
  lines.push('| Metric | Before | After | Change |');
  lines.push('| --- | --- | --- | --- |');
  lines.push(
    `| Tokens | ${result.overall.tokens.before} | ${result.overall.tokens.after} | ${formatDelta(result.overall.tokens.delta)} (${formatPercent(result.overall.tokens.percentChange)}) |`,
  );
  lines.push(
    `| Estimated cost | ${result.overall.cost.before.toFixed(6)} | ${result.overall.cost.after.toFixed(6)} | ${formatDelta(result.overall.cost.delta, 6)} (${formatPercent(result.overall.cost.percentChange)}) |`,
  );
  lines.push(
    `| Correctness rate | ${(result.overall.correctnessRate.before * 100).toFixed(1)}% | ${(result.overall.correctnessRate.after * 100).toFixed(1)}% | ${formatDelta(result.overall.correctnessRate.delta * 100, 1)}pp |`,
  );
  lines.push('');

  lines.push('## Per task', '');
  lines.push('| Task | Kind | Tokens Δ | Cost Δ | Correctness Δ | Regressed |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const task of result.perTask) {
    lines.push(
      `| ${task.taskId} | ${task.kind} | ${formatDelta(task.tokens.delta)} | ${formatDelta(task.cost.delta, 6)} | ${formatDelta(task.correctnessRate.delta * 100, 1)}pp | ${task.regressed ? '**yes**' : 'no'} |`,
    );
  }
  lines.push('');

  if (result.regressedTasks.length > 0) {
    lines.push('## Regressed tasks', '');
    for (const taskId of result.regressedTasks) {
      lines.push(`- ${taskId}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
