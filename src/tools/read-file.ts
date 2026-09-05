import type { ToolResult } from '../llm/types.js';
import type { Tool } from './types.js';

const PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    start_line: { type: 'integer', description: 'First line to return (1-indexed). Must be given together with end_line; omit both to read the whole file.' },
    end_line: { type: 'integer', description: 'Last line to return (1-indexed, inclusive). Must be given together with start_line.' },
  },
  required: ['path'],
};

/**
 * `read_file` — reads a file's contents via `cat <path>` inside the sandbox,
 * or, when `start_line`/`end_line` are given, only that range of lines (via
 * `wc -l` + `sed -n`), so answering a question about part of a file does not
 * put the whole file into the context.
 */
export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file at the given path inside the sandbox. Optionally bounded to a range of lines.',
  parameters: PARAMETERS,
  async execute(context, args) {
    const path = args.path;
    if (typeof path !== 'string') {
      return { ok: false, error: 'read_file requires a string "path" argument' };
    }

    const hasStart = args.start_line !== undefined;
    const hasEnd = args.end_line !== undefined;
    if (hasStart !== hasEnd) {
      return { ok: false, error: 'read_file requires "start_line" and "end_line" together, or neither' };
    }

    if (!hasStart) {
      const exec = await context.execInContainer(`cat ${shellQuote(path)}`);
      if (exec.exitCode === 0) {
        return { ok: true, output: exec.stdout };
      }
      return { ok: false, error: exec.stderr || `cat exited with code ${exec.exitCode}` };
    }

    const startLine = args.start_line;
    const endLine = args.end_line;
    if (
      typeof startLine !== 'number' ||
      typeof endLine !== 'number' ||
      !Number.isInteger(startLine) ||
      !Number.isInteger(endLine) ||
      startLine < 1 ||
      endLine < startLine
    ) {
      return {
        ok: false,
        error: 'read_file requires "start_line" and "end_line" to be integers with start_line >= 1 and end_line >= start_line',
      };
    }

    const countExec = await context.execInContainer(`wc -l < ${shellQuote(path)}`);
    if (countExec.exitCode !== 0) {
      return { ok: false, error: countExec.stderr || `wc exited with code ${countExec.exitCode}` };
    }
    const totalLines = parseInt(countExec.stdout.trim(), 10) || 0;

    if (startLine > totalLines) {
      return { ok: true, output: `Range ${startLine}-${endLine} is empty: the file has ${totalLines} line(s).` };
    }

    const clampedEnd = Math.min(endLine, totalLines);
    const rangeExec = await context.execInContainer(`sed -n '${startLine},${clampedEnd}p' ${shellQuote(path)}`);
    if (rangeExec.exitCode !== 0) {
      return { ok: false, error: rangeExec.stderr || `sed exited with code ${rangeExec.exitCode}` };
    }
    return { ok: true, output: `Lines ${startLine}-${clampedEnd} of ${totalLines}:\n${rangeExec.stdout}` };
  },
};

/** Single-quote a path argument for safe inclusion in a shell command. */
function shellQuote(path: string): string {
  return `'${path.replace(/'/g, `'"'"'`)}'`;
}
