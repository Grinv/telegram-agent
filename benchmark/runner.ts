import { DatabaseSync } from 'node:sqlite';
import { createMessageHandler } from '../src/orchestrator.js';
import type { CallLlm } from '../src/llm/types.js';
import type { SandboxExecutor } from '../src/sandbox/sandbox-executor.js';
import type { ToolRegistry } from '../src/tools/registry.js';
import type { SkillLibrary } from '../src/skills/types.js';
import type { Router } from '../src/routing/types.js';
import type { StatsRecorder } from '../src/stats/types.js';
import type { TelegramMessage } from '../src/telegram/client.js';
import { createInMemoryHistoryStore } from './in-memory-history-store.js';
import { createCapturingReplier } from './capturing-replier.js';
import { taskSetId } from './task-set-id.js';
import type { BenchmarkTask, TaskKind } from './types.js';

/**
 * Dependencies for a benchmark run. `router` is accepted only for parity
 * with how the bot is normally wired (`OrchestratorDeps.router`) and is
 * deliberately never forwarded to the message handler — a benchmark run
 * always uses the pinned `model` for every task and never routes (see
 * design.md — "Pin the model and disable routing").
 *
 * `callLlm` and `statsRecorder` are used exactly as given, rather than
 * built internally, because both must be the *same instance* the caller
 * also wires into `toolRegistry`'s sub-agent tools (via their
 * `ToolContext.callLlm`/`ToolContext.statsRecorder`) — otherwise sub-agent
 * calls would silently skip sampling and go unrecorded. If the caller wants
 * deterministic sampling, it must already be baked into `callLlm` (see
 * `with-sampling.ts`); `statsRecorder` must already point at
 * `statsDbPath` (e.g. via `createStatsRecorder` from `src/stats/index.js`).
 * The runner has no way to reach into a registry's tools to rewrap them, so
 * it can only rely on the caller having shared the same instances.
 */
export interface RunnerDeps {
  tasks: BenchmarkTask[];
  /** How many times to run each task. */
  repetitions: number;
  /** The single model every task is run against. */
  model: string;
  callLlm: CallLlm;
  provider: string;
  timeoutMs: number;
  sandboxExecutor: SandboxExecutor;
  toolRegistry: ToolRegistry;
  skillLibrary?: SkillLibrary;
  maxIterations: number;
  /**
   * Recorder for the benchmark's own stats database, separate from the one
   * real usage writes to (see specs/agent-benchmark/spec.md — "Benchmark
   * activity is kept out of real usage statistics"). Must be constructed
   * against `statsDbPath`.
   */
  statsRecorder: StatsRecorder;
  /**
   * Path to the same database `statsRecorder` writes to. Every execution's
   * tokens, cost, turns and tool calls are read back from here after it
   * runs — including sub-agent activity, which the orchestrator already
   * attributes to the same message via `statsRecorder` (see
   * src/tools/spawn-subagent.ts).
   */
  statsDbPath: string;
  router?: Router;
  conversationCompactionThreshold?: number;
}

/** Recorded outcome of one execution of one task (one repetition). */
export interface TaskExecutionResult {
  taskId: string;
  kind: TaskKind;
  repetition: number;
  correct: boolean;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  turns: number;
  toolCalls: number;
  replies: string[];
}

/** The full result of one benchmark run, before it is saved as a labelled snapshot. */
export interface BenchmarkRunResult {
  model: string;
  taskSetId: string;
  executions: TaskExecutionResult[];
}

const BENCHMARK_CHAT_ID = 1;

/**
 * Runs every task in `deps.tasks`, `deps.repetitions` times each, against
 * the real message handler. Executions run strictly sequentially — never
 * concurrently — both because the stats recorder attributes calls to
 * "whichever message is currently pending" (see
 * `src/stats/sqlite-recorder.ts`), which only holds under sequential
 * processing, and because determinism is already strained enough without
 * adding scheduling nondeterminism on top.
 */
export async function runBenchmark(deps: RunnerDeps): Promise<BenchmarkRunResult> {
  const readDb = new DatabaseSync(deps.statsDbPath);
  try {
    const executions: TaskExecutionResult[] = [];
    for (const task of deps.tasks) {
      for (let repetition = 0; repetition < deps.repetitions; repetition++) {
        executions.push(await runOneExecution(task, repetition, deps, readDb));
      }
    }
    return { model: deps.model, taskSetId: taskSetId(deps.tasks), executions };
  } finally {
    readDb.close();
  }
}

async function runOneExecution(
  task: BenchmarkTask,
  repetition: number,
  deps: RunnerDeps,
  readDb: DatabaseSync,
): Promise<TaskExecutionResult> {
  const sinceMessageId = currentMaxMessageId(readDb);

  const { replier, replies } = createCapturingReplier();
  const handleMessage = createMessageHandler({
    client: replier,
    provider: deps.provider,
    timeoutMs: deps.timeoutMs,
    sandboxExecutor: deps.sandboxExecutor,
    toolRegistry: deps.toolRegistry,
    historyStore: createInMemoryHistoryStore(),
    maxIterations: deps.maxIterations,
    model: deps.model,
    callLlm: deps.callLlm,
    ...(deps.skillLibrary ? { skillLibrary: deps.skillLibrary } : {}),
    ...(deps.conversationCompactionThreshold !== undefined
      ? { conversationCompactionThreshold: deps.conversationCompactionThreshold }
      : {}),
    statsRecorder: deps.statsRecorder,
    // `router` is intentionally never forwarded here — see RunnerDeps.router.
  });

  for (const turnText of task.turns) {
    const message: TelegramMessage = { message_id: 1, chat: { id: BENCHMARK_CHAT_ID }, text: turnText };
    await handleMessage(message);
  }

  const aggregate = readExecutionAggregate(readDb, sinceMessageId);

  return {
    taskId: task.id,
    kind: task.kind,
    repetition,
    correct: task.check(replies),
    inputTokens: aggregate.inputTokens,
    outputTokens: aggregate.outputTokens,
    estimatedCost: aggregate.estimatedCost,
    turns: aggregate.turns,
    toolCalls: aggregate.toolCalls,
    replies,
  };
}

function currentMaxMessageId(readDb: DatabaseSync): number {
  const row = readDb.prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM messages').get() as { max_id: number };
  return row.max_id;
}

interface ExecutionAggregate {
  turns: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

/**
 * Reads back everything recorded for message rows inserted after
 * `sinceMessageId` — i.e. by the execution that just ran. `llm_calls` and
 * `tool_calls` already include sub-agent activity (the orchestrator
 * attributes it to the same `message_id` as the parent — see
 * `src/tools/spawn-subagent.ts`), so no separate accounting for sub-agents
 * is needed here.
 */
function readExecutionAggregate(readDb: DatabaseSync, sinceMessageId: number): ExecutionAggregate {
  const llm = readDb
    .prepare(
      `SELECT COUNT(*) AS turns,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(estimated_cost), 0) AS estimated_cost
       FROM llm_calls WHERE message_id > ?`,
    )
    .get(sinceMessageId) as { turns: number; input_tokens: number; output_tokens: number; estimated_cost: number };

  const tools = readDb.prepare(`SELECT COUNT(*) AS tool_calls FROM tool_calls WHERE message_id > ?`).get(sinceMessageId) as {
    tool_calls: number;
  };

  return {
    turns: llm.turns,
    toolCalls: tools.tool_calls,
    inputTokens: llm.input_tokens,
    outputTokens: llm.output_tokens,
    estimatedCost: llm.estimated_cost,
  };
}
