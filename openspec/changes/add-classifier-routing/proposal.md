## Why

After changes 1 and 2, all LLM calls use a single model (`OLLAMA_MODEL`). The user needs to route simple messages to a small/fast model and complex ones to a larger/capable model — to save tokens and reduce latency. A small classifier LLM can understand the semantic intent of a message (not just length/keywords) and pick the best model. Ollama already exposes which models are available (`/api/tags`) and their capabilities (`/api/show`, including `tools` support), so the model registry is discovered dynamically at startup — no config file needed.

## What Changes

- Add a **model discovery** module (`src/routing/`) that queries Ollama's `/api/tags` and `/api/show` endpoints at startup to build a registry of available models with their metadata (name, parameter size, family, tool-call support).
- Add a **classifier** that uses a small, auto-selected model to classify which model should handle a given message. The classifier receives the user message and the list of available models (with metadata), and returns the chosen model name.
- Auto-select the **classifier model** (smallest by parameter size) and the **fallback model** (largest with `tools` support) at discovery time. Both can be overridden via env vars.
- Integrate routing into the orchestrator: before the think → act → observe loop, call the classifier to select a model, then pass `model` in the `LlmRequest` (the `model?` field already exists from change 1). The classifier call itself is recorded in stats with `role="classifier"` (the stats hook points and `role` field already exist from changes 1 and 2).
- Handle failure modes: classifier timeout → fallback model; classifier returns unrecognized name → fallback model; classifier unavailable (Ollama down) → fallback model. All fallbacks are logged in stats.

## Capabilities

### New Capabilities
- `model-routing`: Dynamic model discovery from Ollama and LLM-based classification to route each message to the best-fitting model, with automatic classifier/fallback selection and graceful degradation on failure.

### Modified Capabilities
- `bot-orchestrator`: The orchestrator calls the classifier before the loop and passes the selected model into `runLoop` via `LlmRequest.model`. The loop itself is unchanged.

## Impact

- New: `src/routing/types.ts` — `ModelEntry` (`{ name, parameterSize, family, supportsTools }`), `RoutingDecision` (`{ model, source: "classifier" | "fallback", reason? }`).
- New: `src/routing/model-discovery.ts` — `discoverModels(ollamaBaseUrl, fetchImpl)` queries `/api/tags` + `/api/show` for each model, returns `ModelEntry[]`. Injectable `fetchImpl` for testing.
- New: `src/routing/classifier.ts` — `classifyModel(message, models, deps)` calls the classifier LLM with a prompt listing available models and their metadata, returns the chosen model name. Injectable `callLlm` for testing.
- New: `src/routing/index.ts` — `createRouter(deps)` factory: takes discovered models, auto-selects classifier + fallback, returns a `Router` with `route(message): Promise<RoutingDecision>`.
- `src/orchestrator.ts`: `createMessageHandler` accepts an optional `router` dep. When provided, calls `router.route(message)` before `runLoop` and passes the selected model. When `undefined`, behavior is unchanged (uses connector's default model).
- `src/index.ts`: wires `discoverModels` + `createRouter` at startup, passes `router` to `createMessageHandler`.
- `src/config.ts`: adds `classifierModel` (env `CLASSIFIER_MODEL`, empty = auto), `classifierTimeoutMs` (env `CLASSIFIER_TIMEOUT_MS`, default 5000), `routerFallbackModel` (env `ROUTER_FALLBACK_MODEL`, empty = auto).
- `.env.example` / `README.md`: document routing env vars and auto-selection logic.
- Tests: new `test/routing/` directory with `model-discovery.test.ts` (fake `fetchImpl` returning `/api/tags` + `/api/show` responses) and `classifier.test.ts` (fake `callLlm` returning a model name).
- No external npm dependencies — model discovery uses `fetch`, classifier uses the existing `callLlm` forked-child-process isolation.
