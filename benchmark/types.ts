/** The token-consuming shape a benchmark task is designed to exercise. */
export type TaskKind = 'no-tools' | 'command' | 'file-read' | 'skill' | 'subagent' | 'multi-turn';

/**
 * One benchmark task: a message (or, for multi-turn tasks, a sequence of
 * messages sent to the same chat) plus a mechanical check that decides
 * whether the agent's reply (or replies) were correct.
 *
 * `check` must be a pure function of its input - no model call, no
 * randomness, no external state - so evaluating it twice on the same
 * replies always returns the same verdict (see specs/agent-benchmark/spec.md
 * - "Correctness does not depend on a model").
 */
export interface BenchmarkTask {
  id: string;
  kind: TaskKind;
  /** Messages sent in sequence to the same chat. Single-turn tasks have exactly one. */
  turns: string[];
  /** Given the reply to every turn, in order, decides whether the task was answered correctly. */
  check: (replies: string[]) => boolean;
}
