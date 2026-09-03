## 1. Dependency and mechanism

- [x] 1.1 Add `undici` under a new `dependencies` field in `package.json` (this project currently has none) and run `npm install` to update `package-lock.json`. Verify: `npx tsc --noEmit` passes and `package-lock.json` reflects the new dependency.
- [x] 1.2 Create `src/llm/configure-fetch-timeouts.ts` exporting `FETCH_TIMEOUT_MS` (a constant well above undici's 300_000ms default and above any timeout this system lets an operator configure — see design.md — Decisions for sizing rationale) and a function `configureFetchTimeouts(timeoutMs = FETCH_TIMEOUT_MS, setDispatcher = setGlobalDispatcher, AgentCtor = Agent)` that calls `setDispatcher(new AgentCtor({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs }))`. The injectable `setDispatcher`/`AgentCtor` parameters exist so tests can observe what was constructed without depending on undici's internals. Verify: `npx tsc --noEmit` passes.
- [x] 1.3 Call `configureFetchTimeouts()` once at the top of `src/llm/inference-runner.ts`, before `process.on('message', ...)` is registered, with a comment explaining why (undici's default fetch timeout otherwise silently caps `LLM_TIMEOUT_MS` below its configured value — see design.md — Context). Verify: `npx tsc --noEmit` passes.

## 2. Tests

- [x] 2.1 Unit-test `configure-fetch-timeouts.ts` in `test/llm/configure-fetch-timeouts.test.ts`: calling `configureFetchTimeouts()` with injected fakes constructs an `Agent`-like object with `headersTimeout` and `bodyTimeout` both equal to `FETCH_TIMEOUT_MS`, and passes that constructed instance to the injected dispatcher setter. Verify: `npm test` passes.
- [x] 2.2 In the same file, assert `FETCH_TIMEOUT_MS` is strictly greater than 600_000 (double undici's own 300_000ms default, so it is unambiguously not just barely above it). Verify: `npm test` passes.
- [x] 2.3 In the same file, add an integration-style test proving the mechanism at test-suite timescale (covers spec.md's new scenario "A slow but legitimate call outlasts a transport-internal default"): start a local `node:http` server that delays its response by a short fixed amount (e.g. 150ms); call the real `configureFetchTimeouts` (not the injected-fake version) with a small timeout below that delay and confirm a real `fetch` to that server fails; then call it again with a larger timeout above that delay and confirm the same request now succeeds. Restore the process's original global dispatcher in a `finally` so this test does not leak state into others in the same file. Verify: `npm test` passes.
- [x] 2.4 Confirm `test/llms/ollama.test.ts` (which injects a fake `fetchImpl` and never touches the real dispatcher) and `test/llm/inference-caller.test.ts` (the outer kill-timer tests, covering spec.md's unchanged "Inference hangs" scenario) both still pass unmodified — this fix must not require changing either. Verify: `npm test` passes with no edits needed to those two files.

## 3. Final verification

- [x] 3.1 Run `npm test` and `npx tsc --noEmit`; both must pass with no new failures. Verify: `npm test` exits 0 and `tsc` reports no errors.
