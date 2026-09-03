import type { CallLlm, ToolDefinition, ToolResult } from '../llm/types.js';
import type { SandboxExecutor } from '../sandbox/sandbox-executor.js';
import type { ToolRegistry } from './registry.js';
import type { runLoop } from '../orchestrator.js';
import type { Router } from '../routing/types.js';
import type { StatsRecorder } from '../stats/types.js';
import type { SkillLibrary } from '../skills/types.js';

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
 *
 * The remaining fields are only used by tools that start nested loops (e.g.
 * `spawn_subagent`); every other tool ignores them. `provider`/`timeoutMs`
 * are included alongside `callLlm` because `runLoop`'s deps require them to
 * build each inference call's options, mirroring `OrchestratorDeps` in
 * `src/orchestrator.ts`.
 */
export interface ToolContext {
  execInContainer: (command: string, stdin?: string) => Promise<ContainerExecResult>;
  callLlm?: CallLlm;
  provider?: string;
  timeoutMs?: number;
  sandboxExecutor?: SandboxExecutor;
  toolRegistry?: ToolRegistry;
  runLoop?: typeof runLoop;
  router?: Router;
  statsRecorder?: StatsRecorder;
  maxSubIterations?: number;
  maxSubagents?: number;
  /** Authored skills loaded at startup; backs `read_skill`. See `src/skills/`. */
  skillLibrary?: SkillLibrary;
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
