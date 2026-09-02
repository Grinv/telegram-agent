import { execFile as nodeExecFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

/** Structured result of a `docker` CLI invocation. */
export interface DockerExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface DockerExecOptions {
  /** Abort the invocation if this signal fires. */
  signal?: AbortSignal;
  /** Hard timeout (ms) after which the process is killed. */
  timeoutMs?: number;
  /** Optional string piped to the process's stdin (used by `write_file`). */
  stdin?: string;
  /** Max output buffer size (bytes). Defaults to 4 MB. */
  maxBuffer?: number;
}

export type DockerExecFn = (args: string[], options?: DockerExecOptions) => Promise<DockerExecResult>;

/**
 * Injectable `execFile`-style function. Matches the callback shape of Node's
 * `child_process.execFile`: called with `(file, args, options, callback)`,
 * returns the `ChildProcess` (or `undefined` — fakes may return nothing).
 */
export type ExecFileFn = (
  file: string,
  args: string[],
  options: { signal?: AbortSignal; timeout?: number; maxBuffer?: number },
  callback: (error: ExecFileError | null, stdout: string, stderr: string) => void,
) => ChildProcess | void;

/** Error shape from `child_process.execFile` on non-zero exit or spawn failure. */
export interface ExecFileError extends Error {
  code?: number | string;
  signal?: string;
  stdout?: string;
  stderr?: string;
}

const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;

/**
 * Wraps `child_process.execFile('docker', ...)` with AbortSignal support,
 * timeout, stdin piping, and a structured return value.
 *
 * Non-zero exit codes are **not** thrown — they are returned as
 * `{ exitCode: n }` so callers can distinguish exit codes without try/catch.
 * Only spawn-level failures (binary not found, signal kill) reject.
 */
export function createDockerExec(execFile: ExecFileFn = nodeExecFile as ExecFileFn): DockerExecFn {
  return (args, options = {}) =>
    new Promise<DockerExecResult>((resolve, reject) => {
      const { signal, timeoutMs, stdin, maxBuffer = DEFAULT_MAX_BUFFER } = options;

      const child = execFile(
        'docker',
        args,
        { signal, timeout: timeoutMs, maxBuffer },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ stdout, stderr, exitCode: 0 });
            return;
          }
          const code = error.code;
          if (typeof code === 'number') {
            resolve({ stdout, stderr, exitCode: code });
            return;
          }
          reject(error);
        },
      );

      if (child?.stdin && stdin !== undefined) {
        child.stdin.end(stdin);
      }
    });
}

/** Default `dockerExec` using the real `child_process.execFile`. */
export const dockerExec: DockerExecFn = createDockerExec();
