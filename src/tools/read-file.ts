import type { ToolResult } from '../llm/types.js';
import type { Tool } from './types.js';

const PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Path to the file to read' },
  },
  required: ['path'],
};

/**
 * `read_file` — reads a file's contents via `cat <path>` inside the sandbox.
 */
export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file at the given path inside the sandbox.',
  parameters: PARAMETERS,
  async execute(context, args) {
    const path = args.path;
    if (typeof path !== 'string') {
      return { ok: false, error: 'read_file requires a string "path" argument' };
    }
    const exec = await context.execInContainer(`cat ${shellQuote(path)}`);
    if (exec.exitCode === 0) {
      return { ok: true, output: exec.stdout };
    }
    return { ok: false, error: exec.stderr || `cat exited with code ${exec.exitCode}` };
  },
};

/** Single-quote a path argument for safe inclusion in a shell command. */
function shellQuote(path: string): string {
  return `'${path.replace(/'/g, `'"'"'`)}'`;
}
