import type { ToolResult } from '../llm/types.js';
import type { Tool } from './types.js';

const PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    content: { type: 'string' },
  },
  required: ['path', 'content'],
};

/**
 * `write_file` — writes text content to a file inside the sandbox by piping
 * the content via stdin to `cat > <path>`. The sandbox's workdir is the only
 * writable location; writes outside it fail with a read-only filesystem error.
 */
export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Write text content to a file at the given path inside the sandbox.',
  parameters: PARAMETERS,
  async execute(context, args) {
    const path = args.path;
    const content = args.content;
    if (typeof path !== 'string') {
      return { ok: false, error: 'write_file requires a string "path" argument' };
    }
    if (typeof content !== 'string') {
      return { ok: false, error: 'write_file requires a string "content" argument' };
    }
    const quoted = shellQuote(path);
    const exec = await context.execInContainer(`cat > ${quoted}`, content);
    if (exec.exitCode === 0) {
      return { ok: true, output: `Wrote ${content.length} bytes to ${path}` };
    }
    return { ok: false, error: exec.stderr || `cat exited with code ${exec.exitCode}` };
  },
};

/** Single-quote a path argument for safe inclusion in a shell command. */
function shellQuote(path: string): string {
  return `'${path.replace(/'/g, `'"'"'`)}'`;
}
