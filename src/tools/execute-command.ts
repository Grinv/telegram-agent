import type { ToolResult } from '../llm/types.js';
import type { Tool } from './types.js';

const PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'The shell command to execute inside the sandbox' },
  },
  required: ['command'],
};

/**
 * `execute_command` — runs an arbitrary shell command inside the sandbox
 * container and returns stdout (on success) or stderr (on failure).
 */
export const executeCommandTool: Tool = {
  name: 'execute_command',
  description: 'Run a shell command inside the sandbox and return its output.',
  parameters: PARAMETERS,
  async execute(context, args) {
    const command = args.command;
    if (typeof command !== 'string') {
      return { ok: false, error: 'execute_command requires a string "command" argument' };
    }
    const exec = await context.execInContainer(command);
    return {
      ok: exec.exitCode === 0,
      output: exec.stdout || undefined,
      error: exec.exitCode === 0 ? undefined : exec.stderr || `Command exited with code ${exec.exitCode}`,
    };
  },
};
