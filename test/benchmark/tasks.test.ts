import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalReplyContains, finalReplyContainsAll, finalReplyContainsNumbers } from '../../benchmark/checks.js';
import { BENCHMARK_TASKS } from '../../benchmark/tasks.js';
import { taskSetId } from '../../benchmark/task-set-id.js';
import type { BenchmarkTask, TaskKind } from '../../benchmark/types.js';

// ---------------------------------------------------------------------------
// Correctness checks: pure, isolated from any task, run against sample replies.
// ---------------------------------------------------------------------------

test('finalReplyContains matches case-insensitively against the last reply only', () => {
  const check = finalReplyContains('paris');
  assert.equal(check(['The capital is Paris.']), true);
  assert.equal(check(['PARIS']), true);
  assert.equal(check(['irrelevant', 'Paris is the capital of France.']), true);
  assert.equal(check(['Paris', 'London']), false);
  assert.equal(check(['no match here']), false);
});

test('finalReplyContainsAll requires every needle to appear in the last reply', () => {
  const check = finalReplyContainsAll(['alpha', 'beta']);
  assert.equal(check(['alpha and beta both here']), true);
  assert.equal(check(['only alpha here']), false);
  assert.equal(check(['']), false);
});

test('finalReplyContainsNumbers matches standalone numbers, not substrings of longer digit runs', () => {
  const check = finalReplyContainsNumbers([42]);
  assert.equal(check(['The answer is 42.']), true);
  assert.equal(check(['The answer is 142.']), false);
  assert.equal(check(['The answer is 420.']), false);
  assert.equal(check(['19, 42, 54']), true);
});

test('finalReplyContainsNumbers requires all given numbers to be present', () => {
  const check = finalReplyContainsNumbers([19, 42, 54]);
  assert.equal(check(['19, 42, 54']), true);
  assert.equal(check(['19, 42']), false);
});

test('a check returns the same verdict on repeated evaluation of the same reply (covers "Correctness does not depend on a model")', () => {
  for (const task of BENCHMARK_TASKS) {
    const sampleReplies = task.turns.map(() => 'an arbitrary reply');
    const first = task.check(sampleReplies);
    const second = task.check(sampleReplies);
    assert.equal(first, second, `task "${task.id}" returned different verdicts across repeated evaluation`);
  }
});

// ---------------------------------------------------------------------------
// Task set shape
// ---------------------------------------------------------------------------

test('a task declares its own correctness check (covers "A task declares its own correctness check")', () => {
  for (const task of BENCHMARK_TASKS) {
    assert.ok(task.turns.length > 0, `task "${task.id}" has no turns`);
    assert.equal(typeof task.check, 'function', `task "${task.id}" has no check function`);
  }
});

test('the task set covers each differing token profile at least once (covers "The set covers differing token profiles")', () => {
  const requiredKinds: TaskKind[] = ['no-tools', 'command', 'file-read', 'skill', 'subagent', 'multi-turn'];
  const presentKinds = new Set(BENCHMARK_TASKS.map((task) => task.kind));
  for (const kind of requiredKinds) {
    assert.ok(presentKinds.has(kind), `no task of kind "${kind}" in the benchmark task set`);
  }
});

test('every task id is unique', () => {
  const ids = BENCHMARK_TASKS.map((task) => task.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the multi-turn task actually has more than one turn', () => {
  const multiTurn = BENCHMARK_TASKS.find((task) => task.kind === 'multi-turn');
  assert.ok(multiTurn);
  assert.ok(multiTurn!.turns.length > 1);
});

// ---------------------------------------------------------------------------
// Task set identity
// ---------------------------------------------------------------------------

test('taskSetId is deterministic for the same task set', () => {
  assert.equal(taskSetId(BENCHMARK_TASKS), taskSetId(BENCHMARK_TASKS));
});

test('taskSetId changes when a turn is edited', () => {
  const edited: BenchmarkTask[] = BENCHMARK_TASKS.map((task, i) =>
    i === 0 ? { ...task, turns: [...task.turns, 'an extra turn'] } : task,
  );
  assert.notEqual(taskSetId(BENCHMARK_TASKS), taskSetId(edited));
});

test('taskSetId changes when a check function is edited', () => {
  const edited: BenchmarkTask[] = BENCHMARK_TASKS.map((task, i) =>
    i === 0 ? { ...task, check: () => true } : task,
  );
  assert.notEqual(taskSetId(BENCHMARK_TASKS), taskSetId(edited));
});
