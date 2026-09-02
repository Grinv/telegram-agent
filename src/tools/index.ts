import type { ToolDefinition } from '../llm/types.js';
import { ToolRegistry } from './registry.js';
import type { Tool, ToolContext } from './types.js';
import { executeCommandTool } from './execute-command.js';
import { readFileTool } from './read-file.js';
import { writeFileTool } from './write-file.js';
import { listFilesTool } from './list-files.js';

export { ToolRegistry, ToolNotFoundError } from './registry.js';
export type { Tool, ToolContext, ContainerExecResult } from './types.js';
export { executeCommandTool } from './execute-command.js';
export { readFileTool } from './read-file.js';
export { writeFileTool } from './write-file.js';
export { listFilesTool } from './list-files.js';

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

export type { ToolDefinition };
