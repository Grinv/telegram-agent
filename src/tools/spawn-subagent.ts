import type { ChatMessage } from '../llm/types.js';
import type { Tool, ToolContext } from './types.js';

const PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    task: { type: 'string' },
    model: { type: 'string', description: 'Model to use (optional, uses classifier/default if omitted)' },
  },
  required: ['task'],
};

/**
 * `spawn_subagent` — runs a nested think → act → observe loop (via
 * `context.runLoop`) with a fresh sandbox for an independent sub-task. The
 * sub-agent's registry excludes `spawn_subagent`/`spawn_subagents` so it
 * cannot spawn further sub-agents (recursion guard).
 */
export const spawnSubagentTool: Tool = {
  name: 'spawn_subagent',
  description:
    'Spawn a sub-agent to handle an independent sub-task. The sub-agent runs its own think-act-observe loop with a fresh sandbox.',
  parameters: PARAMETERS,
  async execute(context: ToolContext, args: Record<string, unknown>) {
    const task = args.task;
    if (typeof task !== 'string') {
      return { ok: false, error: 'spawn_subagent requires a string "task" argument' };
    }
    const model = typeof args.model === 'string' ? args.model : undefined;
    // Not part of the LLM-facing schema: set only by `spawn_subagents` to
    // give each concurrently-running sub-agent a distinct stats identity
    // (see design.md — `agent_id` distinguishes sub-agents that `role`
    // cannot). A lone `spawn_subagent` call has no sibling to be confused
    // with, so it defaults to the shared "subagent" identity.
    const agentId = typeof args.agentId === 'string' ? args.agentId : 'subagent';

    if (
      !context.runLoop ||
      !context.toolRegistry ||
      !context.callLlm ||
      !context.sandboxExecutor ||
      context.provider === undefined ||
      context.timeoutMs === undefined
    ) {
      return {
        ok: false,
        error: 'Subagent execution not available: missing runLoop/toolRegistry/callLlm/sandboxExecutor/provider/timeoutMs in context',
      };
    }

    const subRegistry = context.toolRegistry.without(['spawn_subagent', 'spawn_subagents']);
    const messages: ChatMessage[] = [{ role: 'user', content: task }];
    const tools = subRegistry.getDefinitions();

    const result = await context.runLoop(messages, tools, {
      callLlm: context.callLlm,
      provider: context.provider,
      timeoutMs: context.timeoutMs,
      sandboxExecutor: context.sandboxExecutor,
      toolRegistry: subRegistry,
      ...(context.statsRecorder ? { statsRecorder: context.statsRecorder } : {}),
      maxIterations: context.maxSubIterations ?? 3,
      ...(model ? { model } : {}),
      role: 'subagent',
      agentId,
    });

    return result.ok ? { ok: true, output: result.text } : { ok: false, error: result.reason };
  },
};
