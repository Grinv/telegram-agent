import type { ToolDefinition } from '../llm/types.js';
import type { Tool } from './types.js';

export class ToolNotFoundError extends Error {
  constructor(name: string) {
    super(`No tool registered with name "${name}"`);
    this.name = 'ToolNotFoundError';
  }
}

/**
 * Registry of available tools. Tools are registered by name; the orchestrator
 * fetches definitions (for the LLM) and dispatches calls by name. Adding a
 * tool = `register(it)`; no orchestrator change.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  getDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  getTool(name: string): Tool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolNotFoundError(name);
    }
    return tool;
  }

  isEmpty(): boolean {
    return this.tools.size === 0;
  }
}
