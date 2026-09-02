import type { ToolResult } from '../llm/types.js';
import type { Tool } from './types.js';

const PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Path to the directory to list' },
  },
  required: ['path'],
};

/**
 * `list_files` — lists directory entries via `ls -la <path>` inside the sandbox.
 */
export const listFilesTool: Tool = {
  name: 'list_files',
  description: 'List files and directories at the given path inside the sandbox.',
  parameters: PARAMETERS,
  async execute(context, args) {
    const path = args.path;
    if (typeof path !== 'string') {
      return { ok: false, error: 'list_files requires a string "path" argument' };
    }
    const exec = await context.execInContainer(`ls -la ${shellQuote(path)}`);
    if (exec.exitCode === 0) {
      return { ok: true, output: exec.stdout };
    }
    return { ok: false, error: exec.stderr || `ls exited with code ${exec.exitCode}` };
  },
};

/** Single-quote a path argument for safe inclusion in a shell command. */
function shellQuote(path: string): string {
  return `'${path.replace(/'/g, `'"'"'`)}'`;
}
