## Why

The LLM sometimes requests a tool call using a name that isn't registered (e.g. it hallucinates a plausible-sounding tool). Right now this crashes the whole message handler instead of letting the agent loop recover: `ToolRegistry.getTool()` throws synchronously, the throw isn't caught anywhere inside the sandbox executor or the orchestrator loop, and it's only caught by `createMessageHandler`'s outer try/catch, which discards the loop state and sends a generic "could not process your message" reply. Reproduced live against a real Ollama model and a real Docker sandbox: the model called a nonexistent tool named `echo`, and the bot sent the generic failure notice instead of giving the LLM a chance to see the error and retry with a valid tool name.

## What Changes

- `DockerSandboxExecutor.execute()` catches an unregistered-tool-name lookup failure per tool call and turns it into a structured `ToolObservation` (`{ ok: false, error: '...' }`) instead of letting the exception propagate, matching how every other tool failure (non-zero exit, timeout) is already reported.
- When one tool call in a batch fails this way, the remaining tool calls in that batch still execute (consistent with how any other single tool failure doesn't abort sibling calls in the same act step).
- The think → act → observe loop then feeds this observation back to the LLM exactly like any other tool failure, so the LLM can retry with a correct tool name or a different approach, instead of the loop aborting outright.

## Capabilities

### Modified Capabilities
- `sandbox-execution`: "Tool execution results are structured" gains an explicit scenario for a tool call naming an unregistered tool — it must return a structured failure result, not throw.

## Impact

- `src/sandbox/sandbox-executor.ts`: `DockerSandboxExecutor.execute()` wraps the `registry.getTool(call.name)` lookup (and the subsequent `tool.execute()` call) so a thrown error becomes a `{ ok: false, error }` observation for that tool call, rather than rejecting the whole `execute()` call.
- `src/orchestrator.ts`: no change expected — `runLoop` already feeds any `ToolObservation` with `ok: false` back to the LLM as a `tool` message; this fix makes the unregistered-tool case reach that existing path instead of bypassing it via a thrown exception.
- Tests: `test/sandbox/sandbox-executor.test.ts` gains a case for an unregistered tool name; `test/orchestrator.test.ts` gains a loop-level case confirming the LLM sees the error and can respond.
</content>
