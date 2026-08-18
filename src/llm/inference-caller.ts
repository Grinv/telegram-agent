import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { LlmResult } from './types.js';

// Mirror this module's own extension (.ts under tsx in dev, .js in the built dist/)
// so the forked runner is resolved the same way regardless of how we're running.
const here = fileURLToPath(import.meta.url);
const DEFAULT_RUNNER_PATH = path.join(path.dirname(here), `inference-runner${path.extname(here)}`);

const DEFAULT_TIMEOUT_MS = 15_000;

export interface CallLlmIsolatedOptions {
  provider: string;
  timeoutMs?: number;
  runnerPath?: string;
  onChildSpawned?: (child: ChildProcess) => void;
}

export function callLlmIsolated(prompt: string, options: CallLlmIsolatedOptions): Promise<LlmResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const runnerPath = options.runnerPath ?? DEFAULT_RUNNER_PATH;

  return new Promise<LlmResult>((resolve) => {
    let settled = false;

    const child = fork(runnerPath, [], { stdio: 'ignore' });
    options.onChildSpawned?.(child);

    const settle = (result: LlmResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      child.kill('SIGKILL');
      settle({ ok: false, reason: 'TIMEOUT', message: `Inference timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.once('message', (result: LlmResult) => {
      settle(result);
      child.kill();
    });

    child.once('error', (error) => {
      settle({ ok: false, reason: 'PROVIDER_ERROR', message: error.message });
    });

    child.once('exit', (code) => {
      settle({
        ok: false,
        reason: 'PROVIDER_ERROR',
        message: `Inference process exited unexpectedly with code ${code}`,
      });
    });

    child.send({ prompt, provider: options.provider });
  });
}
