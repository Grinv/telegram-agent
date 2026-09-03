import type { Tool, ToolContext } from './types.js';
import { spawnSubagentTool } from './spawn-subagent.js';

const PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    tasks: { type: 'array', items: { type: 'string' }, description: 'Array of task descriptions' },
    model: { type: 'string', description: 'Model to use for all sub-agents (optional)' },
  },
  required: ['tasks'],
};

/**
 * `spawn_subagents` — runs `spawn_subagent` for each task, in batches of
 * `context.maxSubagents` (default 3) so no more than that many sandboxes
 * exist at once. Individual sub-agent failures are noted in the result
 * array rather than failing the whole tool call.
 */
export const spawnSubagentsTool: Tool = {
  name: 'spawn_subagents',
  description:
    'Spawn multiple sub-agents in parallel for independent sub-tasks. Each runs its own loop with a fresh sandbox.',
  parameters: PARAMETERS,
  async execute(context: ToolContext, args: Record<string, unknown>) {
    const tasks = args.tasks;
    if (!Array.isArray(tasks) || !tasks.every((t) => typeof t === 'string')) {
      return { ok: false, error: 'spawn_subagents requires an array of string "tasks"' };
    }
    const model = typeof args.model === 'string' ? args.model : undefined;
    const maxConcurrent = context.maxSubagents ?? 3;

    const results: string[] = [];
    for (let i = 0; i < tasks.length; i += maxConcurrent) {
      const batch = tasks.slice(i, i + maxConcurrent);
      const batchResults = await Promise.all(
        batch.map((task, j) =>
          // agentId is index-based across the whole call (not just this
          // batch) so ids stay distinct even across successive batches.
          spawnSubagentTool.execute(context, { task, agentId: `subagent-${i + j}`, ...(model ? { model } : {}) }),
        ),
      );
      results.push(...batchResults.map((r) => (r.ok ? (r.output ?? '') : `[failed: ${r.error}]`)));
    }

    return { ok: true, output: JSON.stringify(results) };
  },
};
