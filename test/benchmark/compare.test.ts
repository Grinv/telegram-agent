import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSnapshots } from '../../benchmark/compare.js';
import type { ComparisonResult } from '../../benchmark/compare.js';
import type { Snapshot } from '../../benchmark/snapshot.js';
import type { TaskExecutionResult } from '../../benchmark/runner.js';

function execution(overrides: Partial<TaskExecutionResult>): TaskExecutionResult {
  return {
    taskId: 'taskA',
    kind: 'no-tools',
    repetition: 0,
    correct: true,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
    turns: 1,
    toolCalls: 0,
    replies: [],
    ...overrides,
  };
}

function snapshot(overrides: Partial<Snapshot>): Snapshot {
  return {
    label: 'label',
    createdAt: new Date(0).toISOString(),
    model: 'test-model',
    taskSetId: 'set-1',
    executions: [],
    ...overrides,
  };
}

/**
 * Two fixture snapshots whose changes are computed by hand below:
 *
 * before: taskA [tokens 15,15 correct,correct] taskB [tokens 30,30 correct,incorrect]
 * after:  taskA [tokens 12,12 correct,correct] taskB [tokens 30,30 incorrect,incorrect]
 *
 * taskA tokens: before 30 -> after 24 (delta -6)
 * taskB tokens: before 60 -> after 60 (delta 0)
 * overall tokens: before 90 -> after 84 (delta -6, percentChange -6/90)
 *
 * taskA correctness rate: before 1 -> after 1 (unchanged, not regressed)
 * taskB correctness rate: before 0.5 -> after 0 (regressed)
 * overall correctness rate: before 3/4=0.75 -> after 2/4=0.5 (delta -0.25)
 */
function beforeFixture(): Snapshot {
  return snapshot({
    label: 'before',
    executions: [
      execution({ taskId: 'taskA', inputTokens: 10, outputTokens: 5, estimatedCost: 0.002, correct: true }),
      execution({ taskId: 'taskA', inputTokens: 10, outputTokens: 5, estimatedCost: 0.002, correct: true }),
      execution({ taskId: 'taskB', kind: 'command', inputTokens: 20, outputTokens: 10, estimatedCost: 0.004, correct: true }),
      execution({ taskId: 'taskB', kind: 'command', inputTokens: 20, outputTokens: 10, estimatedCost: 0.004, correct: false }),
    ],
  });
}

function afterFixture(): Snapshot {
  return snapshot({
    label: 'after',
    executions: [
      execution({ taskId: 'taskA', inputTokens: 8, outputTokens: 4, estimatedCost: 0.0016, correct: true }),
      execution({ taskId: 'taskA', inputTokens: 8, outputTokens: 4, estimatedCost: 0.0016, correct: true }),
      execution({ taskId: 'taskB', kind: 'command', inputTokens: 20, outputTokens: 10, estimatedCost: 0.004, correct: false }),
      execution({ taskId: 'taskB', kind: 'command', inputTokens: 20, outputTokens: 10, estimatedCost: 0.004, correct: false }),
    ],
  });
}

test('comparison reports the change in tokens, cost and correctness, overall and per task (task 5.2)', () => {
  const outcome = compareSnapshots(beforeFixture(), afterFixture());
  assert.ok(outcome.comparable);
  const result = outcome as ComparisonResult;

  assert.equal(result.overall.tokens.before, 90);
  assert.equal(result.overall.tokens.after, 84);
  assert.equal(result.overall.tokens.delta, -6);
  assert.equal(result.overall.tokens.percentChange, -6 / 90);

  assert.equal(result.overall.cost.before, 0.012);
  assert.ok(Math.abs(result.overall.cost.after - 0.0112) < 1e-9);
  assert.ok(Math.abs(result.overall.cost.delta - -0.0008) < 1e-9);

  assert.equal(result.overall.correctnessRate.before, 0.75);
  assert.equal(result.overall.correctnessRate.after, 0.5);
  assert.equal(result.overall.correctnessRate.delta, -0.25);

  const taskA = result.perTask.find((t) => t.taskId === 'taskA')!;
  assert.equal(taskA.tokens.before, 30);
  assert.equal(taskA.tokens.after, 24);
  assert.equal(taskA.tokens.delta, -6);

  const taskB = result.perTask.find((t) => t.taskId === 'taskB')!;
  assert.equal(taskB.tokens.before, 60);
  assert.equal(taskB.tokens.after, 60);
  assert.equal(taskB.tokens.delta, 0);
});

test('snapshots with different models are refused rather than diffed (task 5.3)', () => {
  const before = beforeFixture();
  const after = snapshot({ ...afterFixture(), model: 'a-different-model' });

  const outcome = compareSnapshots(before, after);

  assert.equal(outcome.comparable, false);
  assert.match((outcome as { reason: string }).reason, /model/i);
});

test('snapshots with different task-set identities are refused rather than diffed (task 5.3)', () => {
  const before = beforeFixture();
  const after = snapshot({ ...afterFixture(), taskSetId: 'set-2' });

  const outcome = compareSnapshots(before, after);

  assert.equal(outcome.comparable, false);
  assert.match((outcome as { reason: string }).reason, /task set/i);
});

test('a correctness regression in exactly one task is identified per task, not just as a small overall change (task 5.4)', () => {
  const outcome = compareSnapshots(beforeFixture(), afterFixture());
  assert.ok(outcome.comparable);
  const result = outcome as ComparisonResult;

  assert.deepEqual(result.regressedTasks, ['taskB']);

  const taskA = result.perTask.find((t) => t.taskId === 'taskA')!;
  const taskB = result.perTask.find((t) => t.taskId === 'taskB')!;
  assert.equal(taskA.regressed, false);
  assert.equal(taskB.regressed, true);
  assert.equal(taskB.correctnessRate.before, 0.5);
  assert.equal(taskB.correctnessRate.after, 0);
});
