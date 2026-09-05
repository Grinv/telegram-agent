import type { ContainerExecResult } from '../tools/types.js';

export type ExecInContainer = (command: string, stdin?: string) => Promise<ContainerExecResult>;

/**
 * Runs `text` - a shell command's already-captured stdout or stderr -
 * through RTK's `pipe` filter inside the sandbox (see `sandbox/Dockerfile`),
 * feeding it via stdin rather than interpolating it into a command string,
 * so arbitrary command output (quotes, control characters, shell
 * metacharacters) never has to be re-escaped. Returns the compressed text,
 * or `undefined` when RTK is unavailable or errors, so the caller falls
 * back to the raw text rather than failing the tool call over a missing
 * compressor.
 *
 * Deliberately does not re-run the original command through RTK's own
 * command dispatch (`rtk summary <command>`): that requires RTK to
 * re-tokenize and re-execute a shell string, which is unsafe for the
 * arbitrary shell syntax (pipes, loops, quoting) `execute_command` allows.
 * Piping already-captured output through `rtk pipe` never touches how the
 * original command runs.
 */
export async function compressShellOutput(execInContainer: ExecInContainer, text: string): Promise<string | undefined> {
  if (text.length === 0) return undefined;
  try {
    const result = await execInContainer('rtk pipe', text);
    if (result.exitCode !== 0 || result.stdout.length === 0) return undefined;
    return result.stdout;
  } catch {
    return undefined;
  }
}
