## 1. Implementation

- [ ] 1.1 In `src/orchestrator.ts`, inside `handleMessage`'s catch block, call `deps.statsRecorder?.recordMessage({ chatId, replySentAt: Date.now(), ok: false, reason: 'UNEXPECTED_ERROR' })` before (or alongside) sending the failure notice. Verify: `tsc --noEmit` passes.

## 2. Tests

- [ ] 2.1 In `test/orchestrator.test.ts`, add a test where `callLlm` (or another injected dependency) throws synchronously/rejects unexpectedly, a `statsRecorder` fake is provided, and assert `recordMessage` is called a second time with `ok: false` and `reason: 'UNEXPECTED_ERROR'`. Verify: `npm test` passes.
- [ ] 2.2 Confirm the existing test `loop works normally (no errors) when statsRecorder is undefined` (or an equivalent) still passes unchanged — an unexpected error with no `statsRecorder` configured must not throw. Verify: `npm test` passes.

## 3. Final Verification

- [ ] 3.1 Run `npm test` and confirm all tests pass. Verify: `npm test` exits 0.
- [ ] 3.2 Run `tsc --noEmit`. Verify: no type errors.
