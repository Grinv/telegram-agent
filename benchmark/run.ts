import { loadConfig } from '../src/config.js';
import { logger } from '../src/logger.js';
import { createStatsRecorder, loadPriceTable } from '../src/stats/index.js';
import { createSubagentToolRegistry } from '../src/tools/index.js';
import type { ToolContext } from '../src/tools/index.js';
import { DockerSandboxExecutor } from '../src/sandbox/sandbox-executor.js';
import { callLlmIsolated } from '../src/llm/inference-caller.js';
import { runLoop } from '../src/orchestrator.js';
import { loadSkills } from '../src/skills/index.js';
import { runBenchmark } from './runner.js';
import { buildSnapshot, writeSnapshot } from './snapshot.js';
import { withSampling } from './with-sampling.js';
import { withPinnedModel } from './with-pinned-model.js';
import { BENCHMARK_TASKS } from './tasks.js';

const label = process.argv[2];
if (!label) {
  logger.error('Benchmark run: expected a snapshot label argument, e.g. `npm run benchmark:run -- baseline`');
  process.exit(1);
}

const config = loadConfig();

const model = process.env.BENCHMARK_MODEL || process.env.OLLAMA_MODEL || 'llama3';
const repetitions = Number(process.env.BENCHMARK_REPETITIONS ?? 3);
const sampling = {
  temperature: Number(process.env.BENCHMARK_TEMPERATURE ?? 0),
  seed: Number(process.env.BENCHMARK_SEED ?? 42),
};
const statsDbPath = process.env.BENCHMARK_STATS_DB_PATH || 'data/benchmark-stats.db';
const snapshotDir = process.env.BENCHMARK_SNAPSHOT_DIR || 'data/benchmark-snapshots';
const skillsDir = process.env.BENCHMARK_SKILLS_DIR || 'benchmark/skills';

const priceTable = loadPriceTable(config.priceTablePath);
// A sub-agent's own LLM calls are correctly pinned to `model` at the
// provider (see `withPinnedModel` below), but `src/tools/spawn-subagent.ts`
// doesn't forward a model to the stats recorder when its own call omitted
// one, so `SqliteStatsRecorder` labels that row "unknown" - price it the
// same as the pinned model so sub-agent activity isn't silently recorded
// as free.
if (priceTable[model] && !priceTable.unknown) {
  priceTable.unknown = priceTable[model];
}
const skillLibrary = loadSkills(skillsDir);

// Sampling and the pinned model are baked in once and shared between the
// top-level loop and the sub-agent tools' own `callLlm` (via `extraContext`
// below); the stats recorder is likewise constructed once and shared the
// same way — see `RunnerDeps` in `runner.ts` for why all of this must be
// the same instance in both places (otherwise sub-agent calls silently use
// a different model, skip sampling, and go unrecorded).
const callLlm = withPinnedModel(
  withSampling(
    (request, options) => callLlmIsolated(request, { provider: config.llmProvider, timeoutMs: options.timeoutMs }),
    sampling,
  ),
  model,
);
const statsRecorder = createStatsRecorder(statsDbPath, true, priceTable);

const extraContext: Partial<ToolContext> = {
  callLlm,
  provider: config.llmProvider,
  timeoutMs: config.llmTimeoutMs,
  runLoop,
  statsRecorder,
  maxSubagents: config.maxSubagents,
  maxSubIterations: config.maxSubIterations,
  skillLibrary,
};

const toolRegistry = createSubagentToolRegistry({
  execInContainer: async () => {
    throw new Error('execInContainer is only available inside a sandbox call');
  },
  ...extraContext,
});
extraContext.toolRegistry = toolRegistry;

const sandboxExecutor = new DockerSandboxExecutor(
  {
    image: config.sandboxImage,
    timeoutMs: config.sandboxTimeoutMs,
    memoryLimit: config.sandboxMemoryLimit,
    cpuLimit: config.sandboxCpuLimit,
    network: config.sandboxNetwork,
    networkName: config.sandboxNetworkName,
    toolResultMaxBytes: config.toolResultMaxBytes,
  },
  undefined,
  extraContext,
);
extraContext.sandboxExecutor = sandboxExecutor;

logger.info('Benchmark run starting', { label, model, repetitions, taskCount: BENCHMARK_TASKS.length, statsDbPath });

const runResult = await runBenchmark({
  tasks: BENCHMARK_TASKS,
  repetitions,
  model,
  callLlm,
  provider: config.llmProvider,
  timeoutMs: config.llmTimeoutMs,
  sandboxExecutor,
  toolRegistry,
  skillLibrary,
  maxIterations: config.toolUseMaxIterations,
  conversationCompactionThreshold: config.conversationCompactionThreshold,
  statsRecorder,
  statsDbPath,
});

const snapshot = buildSnapshot(label, runResult);
const snapshotPath = await writeSnapshot(snapshot, snapshotDir);

const correct = runResult.executions.filter((e) => e.correct).length;
const total = runResult.executions.length;

logger.info('Benchmark run complete', {
  label,
  snapshotPath,
  executions: total,
  correct,
  correctnessRate: total > 0 ? correct / total : 0,
});
