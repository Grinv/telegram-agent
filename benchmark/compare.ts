import type { Snapshot } from './snapshot.js';
import type { TaskExecutionResult } from './runner.js';
import type { TaskKind } from './types.js';

/** A single metric's before/after values, stated as a direction and magnitude rather than left for the reader to subtract. */
export interface MetricChange {
  before: number;
  after: number;
  delta: number;
  /** `delta / before`, or `null` when `before` is `0` (a percentage would be undefined). */
  percentChange: number | null;
}

export interface TaskComparison {
  taskId: string;
  kind: TaskKind;
  tokens: MetricChange;
  cost: MetricChange;
  correctnessRate: MetricChange;
  /** True when this task's correctness rate dropped between the two snapshots. */
  regressed: boolean;
}

export interface ComparisonResult {
  comparable: true;
  before: { label: string; model: string; taskSetId: string };
  after: { label: string; model: string; taskSetId: string };
  overall: {
    tokens: MetricChange;
    cost: MetricChange;
    correctnessRate: MetricChange;
  };
  perTask: TaskComparison[];
  /** Ids of tasks whose correctness rate dropped, so a regression is visible per task and not just diluted into the overall rate. */
  regressedTasks: string[];
}

export interface ComparisonRefused {
  comparable: false;
  reason: string;
}

export type ComparisonOutcome = ComparisonResult | ComparisonRefused;

/**
 * Compares two snapshots. Refuses (`comparable: false`) rather than diffing
 * when they were produced under conditions that make the difference
 * meaningless: a different model, or a different task set (see
 * design.md — "Snapshots record their conditions, and the comparison
 * refuses mismatches").
 */
export function compareSnapshots(before: Snapshot, after: Snapshot): ComparisonOutcome {
  if (before.model !== after.model) {
    return { comparable: false, reason: `snapshots use different models: "${before.model}" (before) vs "${after.model}" (after)` };
  }
  if (before.taskSetId !== after.taskSetId) {
    return {
      comparable: false,
      reason: `snapshots were produced from different task sets: "${before.taskSetId}" (before) vs "${after.taskSetId}" (after) — the task set was edited between them`,
    };
  }

  const perTask = comparePerTask(before.executions, after.executions);

  return {
    comparable: true,
    before: { label: before.label, model: before.model, taskSetId: before.taskSetId },
    after: { label: after.label, model: after.model, taskSetId: after.taskSetId },
    overall: {
      tokens: metricChange(sumTokens(before.executions), sumTokens(after.executions)),
      cost: metricChange(sumCost(before.executions), sumCost(after.executions)),
      correctnessRate: metricChange(correctnessRate(before.executions), correctnessRate(after.executions)),
    },
    perTask,
    regressedTasks: perTask.filter((t) => t.regressed).map((t) => t.taskId),
  };
}

function comparePerTask(before: TaskExecutionResult[], after: TaskExecutionResult[]): TaskComparison[] {
  const taskIds = [...new Set([...before.map((e) => e.taskId), ...after.map((e) => e.taskId)])];

  return taskIds.map((taskId) => {
    const beforeExecutions = before.filter((e) => e.taskId === taskId);
    const afterExecutions = after.filter((e) => e.taskId === taskId);
    const kind = (afterExecutions[0] ?? beforeExecutions[0]).kind;

    const beforeRate = correctnessRate(beforeExecutions);
    const afterRate = correctnessRate(afterExecutions);

    return {
      taskId,
      kind,
      tokens: metricChange(sumTokens(beforeExecutions), sumTokens(afterExecutions)),
      cost: metricChange(sumCost(beforeExecutions), sumCost(afterExecutions)),
      correctnessRate: metricChange(beforeRate, afterRate),
      regressed: afterRate < beforeRate,
    };
  });
}

function sumTokens(executions: TaskExecutionResult[]): number {
  return executions.reduce((sum, e) => sum + e.inputTokens + e.outputTokens, 0);
}

function sumCost(executions: TaskExecutionResult[]): number {
  return executions.reduce((sum, e) => sum + e.estimatedCost, 0);
}

function correctnessRate(executions: TaskExecutionResult[]): number {
  if (executions.length === 0) return 0;
  return executions.filter((e) => e.correct).length / executions.length;
}

function metricChange(before: number, after: number): MetricChange {
  const delta = after - before;
  return { before, after, delta, percentChange: before !== 0 ? delta / before : null };
}
