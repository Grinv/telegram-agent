import { createHash } from 'node:crypto';
import type { BenchmarkTask } from './types.js';

/**
 * Identifies a task set: changes whenever any task's id, kind, turns, or
 * correctness-check logic changes (`Function.prototype.toString()` picks up
 * a check's implementation, not just its identity), so a snapshot's recorded
 * identifier can reveal the task set having been edited since the snapshot
 * was taken (see design.md - "Snapshots record their conditions").
 */
export function taskSetId(tasks: BenchmarkTask[]): string {
  const canonical = tasks.map((task) => ({
    id: task.id,
    kind: task.kind,
    turns: task.turns,
    check: task.check.toString(),
  }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16);
}
