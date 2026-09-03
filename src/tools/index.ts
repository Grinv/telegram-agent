import type { ToolDefinition } from '../llm/types.js';
import { ToolRegistry } from './registry.js';
import type { Tool, ToolContext } from './types.js';
import { executeCommandTool } from './execute-command.js';
import { readFileTool } from './read-file.js';
import { writeFileTool } from './write-file.js';
import { listFilesTool } from './list-files.js';
import { spawnSubagentTool } from './spawn-subagent.js';
import { spawnSubagentsTool } from './spawn-subagents.js';
import { readSkillTool } from './read-skill.js';

export { ToolRegistry, ToolNotFoundError } from './registry.js';
export type { Tool, ToolContext, ContainerExecResult } from './types.js';
export { executeCommandTool } from './execute-command.js';
export { readFileTool } from './read-file.js';
export { writeFileTool } from './write-file.js';
export { listFilesTool } from './list-files.js';
export { spawnSubagentTool } from './spawn-subagent.js';
export { spawnSubagentsTool } from './spawn-subagents.js';
export { readSkillTool } from './read-skill.js';

/** The four default tools shipped with the bot, in registration order. */
export const DEFAULT_TOOLS: readonly Tool[] = [
  executeCommandTool,
  readFileTool,
  writeFileTool,
  listFilesTool,
];

/** Factory: a fresh `ToolRegistry` pre-populated with all default tools. */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of DEFAULT_TOOLS) {
    registry.register(tool);
  }
  return registry;
}

/**
 * Factory: a fresh `ToolRegistry` with the default tools, plus
 * `spawn_subagent`/`spawn_subagents` when `context` carries what they need
 * (`runLoop` and `callLlm`) to run nested loops, plus `read_skill` when
 * `context` carries a `skillLibrary`. Lets the same wiring code path work
 * whether or not each capability is configured.
 */
export function createSubagentToolRegistry(context: ToolContext): ToolRegistry {
  const registry = createDefaultToolRegistry();
  if (context.runLoop && context.callLlm) {
    registry.register(spawnSubagentTool);
    registry.register(spawnSubagentsTool);
  }
  if (context.skillLibrary) {
    registry.register(readSkillTool);
  }
  return registry;
}

export type { ToolDefinition };
