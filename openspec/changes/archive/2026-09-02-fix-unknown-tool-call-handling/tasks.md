## 1. Fix

- [x] 1.1 In `DockerSandboxExecutor.execute()` (`src/sandbox/sandbox-executor.ts`), wrap the per-tool-call `registry.getTool(call.name)` lookup and `tool.execute(...)` call in a try/catch; on a thrown error, push `{ name: call.name, ok: false, error: <message> }` onto `observations` instead of letting the error propagate, and continue processing the remaining tool calls in the batch. Verify: `tsc --noEmit` passes.

## 2. Tests

- [x] 2.1 Add a case to `test/sandbox/sandbox-executor.test.ts`: a tool call naming an unregistered tool returns `{ ok: false, error }` (naming the unregistered tool) in `observations` instead of `execute()` rejecting, and the sandbox is still torn down in `finally`. Verify: `npm test` passes. (Also updated the pre-existing "tool throws" test, which asserted the old rejecting behavior, to match the new contract.)
- [x] 2.2 Add a case to the same file: a batch with one call to an unregistered tool and one call to a registered tool still executes the registered tool and returns both observations. Verify: `npm test` passes.
- [x] 2.3 Add a loop-level case to `test/orchestrator.test.ts`: the LLM requests an unregistered tool name on the first iteration and a valid tool (or final answer) on the second; assert the loop does not abort with the generic failure reply and instead completes using the fed-back error observation. Verify: `npm test` passes. (Uses the real `DockerSandboxExecutor` + `ToolRegistry`, not a fake executor, so it exercises the actual fixed code path end-to-end.)

## 3. Final Verification

- [x] 3.1 Run `npm test` and confirm all tests pass. Verify: `npm test` exits 0.
- [x] 3.2 Run `tsc --noEmit` and confirm no type errors. Verify: clean output.
</content>
