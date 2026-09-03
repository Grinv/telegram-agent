## Context

See proposal.md — Why, for the empirical evidence (repeated 5m1s failures regardless of configured `LLM_TIMEOUT_MS`).

- `src/llm/inference-caller.ts`'s `callLlmIsolated` forks `src/llm/inference-runner.ts` per call and applies `LLM_TIMEOUT_MS` by killing that child with `SIGKILL` via `setTimeout`. This is the *only* enforcement mechanism the app controls today.
- `src/llm/inference-runner.ts` is a small entrypoint: on `process.on('message', ...)`, it builds a connector via `createConnector(provider)` and calls `connector.callLlm(request)`. It is the single place, across the whole codebase, where an isolated LLM call's `fetch` actually executes — both the main loop's calls and the router's classifier calls (`src/routing/index.ts`'s `createRouter` is wired with `callLlm: (request, options) => callLlmIsolated(...)` in `src/index.ts`) go through it.
- `src/llms/ollama/index.ts`'s `OllamaConnector` takes a `fetchImpl` constructor parameter defaulting to the global `fetch` — already a seam for tests (see `test/llms/ollama.test.ts`'s `capturingFetch` helper), but production code always uses the default, i.e. Node's global `fetch`.
- Node's global `fetch` (Node 24.20.0, confirmed on the exact runtime this project deploys) is implemented on top of `undici`, whose default `Agent` sets `headersTimeout` and `bodyTimeout` to `300_000`ms. There is no dependency-free way to change this on the current Node LTS: `node:undici` is not an importable built-in (`No such built-in module: node:undici`), `process.getBuiltinModule('undici')` returns `undefined`, and neither a Node CLI flag nor a `NODE_OPTIONS` value exposes it. The only documented way to change it is to install the `undici` npm package and call its `setGlobalDispatcher`.

## Goals / Non-Goals

**Goals:**
- Make `LLM_TIMEOUT_MS` (and `CLASSIFIER_TIMEOUT_MS`) the actual effective ceiling on how long an inference call may run, for any configured value.
- Keep the fix to the one process where it matters (`inference-runner.ts`), rather than spreading dispatcher configuration across every entrypoint that happens to import `fetch`.
- Make the new dependency's presence and purpose obvious to a future reader — it exists to raise two timeout numbers, nothing else.

**Non-Goals:**
- Do not replace `fetch` as the project's HTTP client, or use `undici`'s `request`/`Client` APIs directly. `fetch` stays; `undici` is used only for `setGlobalDispatcher`/`Agent`.
- Do not fix `src/index.ts`'s direct `fetch` call for `discoverModels`, or `src/telegram/client.ts`'s requests — neither is evidenced to run anywhere near 300s (see proposal.md — Impact).
- Do not change `LLM_TIMEOUT_MS`'s or `CLASSIFIER_TIMEOUT_MS`'s default values, or add a new env var. The bug is that a configured value above ~300000 was silently ignored; once fixed, existing configuration behaves as already documented.

## Decisions

**Add `undici` as a runtime dependency, scoped to one `setGlobalDispatcher` call.** Confirmed during design research (see Context) that no dependency-free alternative exists on this project's target Node version. This is an explicit, narrow exception to the project's "avoid third-party libraries where a Node built-in covers it" convention (`openspec/config.yaml` — context) — the alternative (leaving `LLM_TIMEOUT_MS` silently capped at ~300s) is worse: it makes a documented, user-facing config value a lie for part of its range, and produces a misleading `PROVIDER_ERROR` instead of the `TIMEOUT` reason that actually describes what happened.

**Install the dispatcher once, at the top of `src/llm/inference-runner.ts`, before any request logic runs.** `inference-runner.ts` is the one process every isolated `fetch` call to an LLM provider actually executes in (see Context). A single `setGlobalDispatcher` call at module load time, before `process.on('message', ...)` is registered, covers every call this process will ever make — no per-request wiring, no risk of a new call path forgetting to apply it. Alternative considered: pass a custom `dispatcher` on each individual `fetch()` call inside `OllamaConnector.callLlm`. Rejected because it would require plumbing a dispatcher instance through the connector's constructor and every call site that might add a new provider later, for no benefit over configuring it once, process-wide, in the one process that needs it.

**Size the raised timeouts generously above any supported configured timeout, not just above the current defaults.** `headersTimeout`/`bodyTimeout` are set to a fixed high value (see tasks.md for the exact number) chosen to exceed the largest timeout this system lets an operator configure, so raising `LLM_TIMEOUT_MS` in `.env` never silently reintroduces this bug at a new ceiling. The dispatcher-level timeout is a backstop, not the mechanism operators are expected to tune — `LLM_TIMEOUT_MS` (enforced by `inference-caller.ts`'s own kill timer) remains the actual, user-facing control.

**Do not touch `src/index.ts` or `discoverModels`.** Considered applying the same dispatcher globally from `src/index.ts` so every `fetch` in the main process is covered uniformly. Rejected for this change: `discoverModels` is a metadata GET (`/api/tags`) with no evidence of ever approaching 300s, and widening scope beyond the one process that's actually broken adds risk (a global dispatcher change in the main process could interact with the Telegram client's `fetch` calls in ways not evaluated here) without a demonstrated problem to fix. If evidence of a real timeout there ever emerges, that's a separate, narrowly-scoped follow-up.

## Risks / Trade-offs

**New runtime dependency in a project that deliberately has none** → Scope the usage tightly (one file, one `setGlobalDispatcher` call, one import) and document why in a code comment at the call site, so a future reader doesn't mistake it for the start of a broader shift away from built-ins.

**A single global dispatcher affects every `fetch` call made from `inference-runner.ts`, not just Ollama's** → Today, `inference-runner.ts` only ever calls the active connector's `callLlm`, and the only connector that calls `fetch` is `ollama`'s (`stub` never does). If a future connector is added that relies on `fetch`'s *default* timeout behavior for some other reason, this dispatcher would change that too. Acceptable now — worth a second look if/when a second `fetch`-based connector is added.

**Raising the timeout ceiling means a genuinely hung request now waits longer before `inference-caller.ts`'s own kill timer fires** → This is the intended fix, not a side effect: `LLM_TIMEOUT_MS` was always meant to be the real ceiling (see the "Inference calls are bounded by a timeout" requirement in `specs/llm-inference/spec.md`); the dispatcher timeout is set high specifically so it never becomes the effective one.
