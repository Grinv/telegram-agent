## 1. Loop classification fix

- [x] 1.1 In `runLoop` (`src/orchestrator.ts`), inside the existing `if (!result.toolCalls || result.toolCalls.length === 0)` success branch, add a check for `result.text.trim().length === 0`: when true, log a warning (iteration, model) and return `{ ok: false, reason: 'EMPTY_RESPONSE', iterations: i + 1 }` instead of the success result. Verify with a unit test: `runLoop` called with a scripted `callLlm` returning `{ ok: true, text: '', toolCalls: undefined }` (no tool calls) returns `{ ok: false, reason: 'EMPTY_RESPONSE', iterations: 1 }`.
- [x] 1.2 Verify with a unit test that a whitespace-only response (`text: '   \n'`, no tool calls) is also classified as `EMPTY_RESPONSE`, not success.
- [x] 1.3 Verify with a unit test that a non-empty response with no tool calls still returns success unchanged (regression check on the existing early-return path).
- [x] 1.4 Verify with a unit test that a response with an empty `text` but a non-empty `toolCalls` array is NOT classified as `EMPTY_RESPONSE` (the loop continues to execute the tool call as before).

## 2. Orchestrator integration

- [x] 2.1 Add a `createMessageHandler`-level unit test (fake `callLlm` returning `{ ok: true, text: '', toolCalls: undefined }`): verify the failure notice (`FAILURE_REPLY_TEXT`) is sent instead of an empty string, `client.sendMessage` is called exactly once, and it is never called with an empty `text` argument.
- [x] 2.2 Verify with a unit test that `statsRecorder.recordMessage`'s finalizing call receives `{ ok: false, reason: 'EMPTY_RESPONSE' }` for this case (not `'DELIVERY_FAILED'`).
- [x] 2.3 Verify with a unit test (using the fake `HistoryStore` pattern already in `test/orchestrator.test.ts`) that only the user's turn is persisted to history for this case, with no assistant turn — same shape as the existing loop-failure history test, confirming the fix doesn't disturb `chat-context-history` behavior.

## 3. Verification

- [x] 3.1 Run the full test suite (`npm test`) and the type check (`npx tsc --noEmit`) and confirm both pass with the new tests included.
