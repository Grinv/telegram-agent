import type { ToolResult } from '../llm/types.js';
import type { Tool } from './types.js';
import { compressShellOutput } from '../context-management/shell-output-compression.js';

const PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'The shell command to execute inside the sandbox' },
  },
  required: ['command'],
};

/**
 * `execute_command` — runs an arbitrary shell command inside the sandbox
 * container and returns stdout (on success) or stderr (on failure),
 * compressed via RTK (see `src/context-management/shell-output-compression.ts`)
 * when compression succeeds. A compressed result is marked `compressed:
 * true` so it is never presented as the command's verbatim output; the
 * tool-result limit (see `src/sandbox/sandbox-executor.ts`) is applied
 * afterwards, to the compressed text.
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
    const ok = exec.exitCode === 0;
    const rawText = ok ? exec.stdout : exec.stderr;

    const compressedText = rawText ? await compressShellOutput(context.execInContainer, rawText) : undefined;
    const text = compressedText ?? rawText;

    return {
      ok,
      output: ok ? (text || undefined) : undefined,
      error: ok ? undefined : text || `Command exited with code ${exec.exitCode}`,
      ...(compressedText !== undefined ? { compressed: true } : {}),
    };
  },
};
