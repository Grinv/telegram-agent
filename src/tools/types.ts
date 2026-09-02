import type { ToolDefinition, ToolResult } from '../llm/types.js';

/**
 * Result of running a command inside the sandbox container. Returned by
 * `ToolContext.execInContainer`.
 */
export interface ContainerExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * The execution environment passed to every tool handler. Intentionally an
 * interface (not a bare function argument) so later changes can extend it
 * with new fields (e.g. `callLlm`, `sandboxExecutor`) without rewriting
 * existing tools — they only read `execInContainer` and ignore the rest.
 *
 * `execInContainer` accepts an optional `stdin` string for tools (like
 * `write_file`) that pipe content into the command via stdin.
 */
export interface ToolContext {
  execInContainer: (command: string, stdin?: string) => Promise<ContainerExecResult>;
}

/**
 * A tool the LLM can request by name. `parameters` is the JSON Schema
 * advertised to the LLM; `execute` runs the tool inside a sandbox via
 * `ToolContext.execInContainer` and returns a structured result.
 */
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(context: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}

/** Convenience: build a `ToolDefinition` (the LLM-facing shape) from a `Tool`. */
export function toDefinition(tool: Tool): ToolDefinition {
  return { name: tool.name, description: tool.description, parameters: tool.parameters };
}
