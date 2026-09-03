## Why

`src/llms/ollama/index.ts`'s `OllamaConnector.callLlm` issues its request with the global `fetch`. Node's `fetch` is backed by `undici` internally, and undici's default `Agent` has `headersTimeout`/`bodyTimeout` of 300000ms (5 minutes) — a ceiling that has nothing to do with this project's own `LLM_TIMEOUT_MS` config.

`LLM_TIMEOUT_MS` is enforced correctly at the outer layer: `src/llm/inference-caller.ts`'s `callLlmIsolated` forks a child process (`src/llm/inference-runner.ts`) and kills it with `setTimeout(..., timeoutMs)` if it hasn't responded in time. But the `fetch()` call running *inside* that child process is subject to undici's independent ~300s ceiling first. When `LLM_TIMEOUT_MS` is configured above ~300000, a slow-but-legitimate request now fails with `{ ok: false, reason: 'PROVIDER_ERROR', message: 'fetch failed' }` at ~300s — never reaching the outer timeout at all, and never surfacing as the `TIMEOUT` reason the rest of the system expects for "took too long."

This was confirmed empirically on 2026-09-03 while verifying `add-agent-skills` against a real, CPU-only Ollama instance: a multi-tool-call request consistently failed at exactly ~5m1s regardless of whether `LLM_TIMEOUT_MS` was set to 290000, 295000, 480000, or 550000. Ollama's own `OLLAMA_LOAD_TIMEOUT` (also defaulting to "5m") had no effect, ruling out the Ollama server itself. A throwaway experiment — installing `undici` and calling `setGlobalDispatcher(new Agent({ headersTimeout, bodyTimeout }))` with a higher value before the connector's first `fetch` call — let a real ~21-minute multi-iteration request complete successfully where it had always failed at 5m1s before.

This is a pre-existing bug, not introduced by `add-agent-skills` — it just never surfaced before because no request had taken longer than 300s until skill-driven multi-tool-call loops did. It silently caps `LLM_TIMEOUT_MS` for every deployment, including production ones with slower hardware or larger models, and the failure it produces (`PROVIDER_ERROR`) is indistinguishable from a genuine Ollama error, hiding the real cause from operators.

## What Changes

- Raise the effective ceiling on how long a single Ollama `fetch()` call may run so that it is no longer capped below the configured `LLM_TIMEOUT_MS`. Node's `fetch` has no built-in, dependency-free way to do this (confirmed on Node 24.20.0: `node:undici` is not an importable built-in, `process.getBuiltinModule('undici')` returns `undefined`, and no CLI flag or `NODE_OPTIONS` controls undici's default dispatcher timeouts) — the only way to raise it is to add the `undici` package as an explicit runtime dependency and call `setGlobalDispatcher` with a longer `headersTimeout`/`bodyTimeout`.
- **This is a deliberate, explicit exception to this project's otherwise dependency-free convention** (`openspec/config.yaml` — context: "Avoid third-party SDKs/libraries where a Node built-in covers it, to limit supply-chain surface"). It is scoped narrowly: `undici` is added only to reconfigure the fetch dispatcher's timeouts, not to replace `fetch` itself as the HTTP client.
- The raised dispatcher must be installed in the forked child process (`src/llm/inference-runner.ts`) — the sole process every isolated LLM call (main-loop and classifier alike) actually runs `fetch` from — since forking does not share in-process JS state with the parent.
- The dispatcher's timeouts must be set high enough to never be the practical limiting factor — i.e., always at or above the largest `LLM_TIMEOUT_MS`/`CLASSIFIER_TIMEOUT_MS` this system supports, not a second hardcoded ceiling that just moves the same problem further out.
- Add test coverage proving a mocked request that legitimately runs longer than 300s succeeds rather than failing early, and that a configured timeout above 300000ms is genuinely honored end to end.

## Capabilities

### Modified Capabilities

- `llm-inference`: the existing requirement "Inference calls are bounded by a timeout" currently only describes the *outer* kill-on-timeout behavior; it does not say that the configured timeout must be the actual effective ceiling regardless of any default internal to the HTTP client the connector happens to use. This change adds that guarantee explicitly.

## Impact

- `src/llm/inference-runner.ts` — the forked child process entrypoint, and the single choke point for every isolated LLM call (`callLlmIsolated` always runs the connector inside this process — this covers both the main think→act→observe loop's calls and the router's classifier calls, since both go through `callLlmIsolated`). The dispatcher must be installed here, at process startup, before the connector's `fetch` ever runs.
- `package.json` — adds `undici` as a new runtime dependency (see explicit exception above).
- New or updated tests under `test/llms/ollama.test.ts` and/or `test/llm/inference-caller.test.ts` proving the fix.
- Not in scope: `src/index.ts`'s direct `fetch` call for `discoverModels` (a fast model-listing metadata request, not observed to run anywhere near 300s), `src/llms/stub/index.ts` (never calls `fetch`), `src/telegram/client.ts` (Telegram requests are not observed to run anywhere near 300s). Revisit only if evidence emerges that either is actually at risk.
