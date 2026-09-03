import type { CallLlm, SamplingControls } from '../src/llm/types.js';

/**
 * Wraps a `CallLlm` so every call requests the given sampling controls,
 * regardless of what the caller passed. Used once to build a single
 * instance that is shared between the runner's top-level loop and the
 * tool context's `callLlm` (which sub-agent tools use) — see
 * `RunnerDeps.callLlm` in `runner.ts` for why it must be the same instance
 * in both places.
 */
export function withSampling(callLlm: CallLlm, sampling: SamplingControls): CallLlm {
  return (request, options) => callLlm({ ...request, sampling }, options);
}
