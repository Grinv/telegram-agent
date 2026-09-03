import type { CallLlm } from '../src/llm/types.js';

/**
 * Wraps a `CallLlm` so a call that doesn't specify a model gets `model`
 * as a default. The top-level loop already pins its model via
 * `OrchestratorDeps.model` (see `runner.ts`), but a sub-agent's own call
 * (`ToolContext.callLlm`, invoked from `src/tools/spawn-subagent.ts`) has
 * no such parameter and, left alone, falls back to whatever
 * `OLLAMA_MODEL` the connector itself defaults to — a different model
 * than the one the run is supposed to be pinned to. Wrapping the single
 * `callLlm` instance shared between the top level and sub-agent tools (see
 * `RunnerDeps` in `runner.ts`) closes that gap without touching
 * `src/tools/spawn-subagent.ts`'s own "model uses default when omitted"
 * behavior — it just makes "default" mean the run's pinned model instead
 * of the connector's.
 */
export function withPinnedModel(callLlm: CallLlm, model: string): CallLlm {
  return (request, options) => callLlm(request.model ? request : { ...request, model }, options);
}
