## 1. Types

- [x] 1.1 Create `src/routing/types.ts` defining `ModelEntry` (`{ name: string, parameterSize: number, family: string, supportsTools: boolean }`), `RoutingDecision` (`{ model: string, source: "classifier" | "fallback", reason?: string, classifierModel: string, classifierUsage?: TokenUsage }`), and `Router` interface (`{ route(message: string): Promise<RoutingDecision> }`). Import `TokenUsage` from `src/llm/types.ts`. Verify: `tsc --noEmit` passes.

## 2. Model Discovery

- [x] 2.1 Create `src/routing/model-discovery.ts` — `discoverModels(ollamaBaseUrl: string, fetchImpl: typeof fetch): Promise<ModelEntry[]>`. Calls `GET /api/tags` to get the model list, then `POST /api/show` for each model to get `capabilities` and `details`. Parses `parameter_size` string ("8B" → 8, "0.5B" → 0.5) to a number. Returns an empty array on fetch failure (logs warning, does not throw). Verify: `tsc --noEmit` passes.
- [x] 2.2 Unit test `discoverModels` with a fake `fetchImpl` returning a `/api/tags` response with 3 models and `/api/show` responses with varying capabilities (one with tools, one without, one with missing capabilities). Assert the returned `ModelEntry[]` has correct names, parameter sizes, and `supportsTools` flags. Verify: `npm test` passes.
- [x] 2.3 Unit test `discoverModels` returns an empty array when `/api/tags` fetch fails (network error, non-OK HTTP status, malformed JSON). Verify: no throw, empty array returned, `npm test` passes.
- [x] 2.4 Unit test `discoverModels` handles malformed `parameter_size` (e.g. "unknown") by defaulting to `0`. Verify: `npm test` passes.

## 3. Classifier

- [x] 3.1 Create `src/routing/classifier.ts` — `classifyModel(message: string, models: ModelEntry[], deps: { callLlm: CallLlm, classifierModel: string, timeoutMs: number }): Promise<{ model: string | null, usage?: TokenUsage }>`. Builds the classifier prompt (message + model list with metadata), calls `callLlm({ prompt, model: classifierModel })`, parses the response text as a model name (trim, match against `models[].name`). Returns `{ model: null, usage }` if the response doesn't match any model name. Returns `{ model: null }` if `callLlm` fails or times out. Verify: `tsc --noEmit` passes.
- [x] 3.2 Unit test `classifyModel` with a fake `callLlm` returning `"llama3.1:8b"` — assert it returns `{ model: "llama3.1:8b" }`. Verify: `npm test` passes.
- [x] 3.3 Unit test `classifyModel` with a fake `callLlm` returning an unrecognized string (e.g. `"gpt-4"`) — assert it returns `{ model: null }`. Verify: `npm test` passes.
- [x] 3.4 Unit test `classifyModel` with a fake `callLlm` returning a failure (`{ ok: false }`) — assert it returns `{ model: null }` without throwing. Verify: `npm test` passes.
- [x] 3.5 Unit test `classifyModel` with a fake `callLlm` returning text with extra whitespace/newlines — assert it trims and matches. Verify: `npm test` passes.

## 4. Router Factory

- [x] 4.1 Create `src/routing/index.ts` — `createRouter(deps: { models: ModelEntry[], callLlm: CallLlm, classifierModel?: string, fallbackModel?: string, classifierTimeoutMs?: number }): Router | null`. Auto-selects classifier (smallest) and fallback (largest with tools, or largest overall). Returns `null` if models has 0 or 1 entries (routing skipped). Returns a `Router` object whose `route(message)` method calls `classifyModel`, applies fallback logic on `null`, and returns a `RoutingDecision` with `source` and `reason`. Verify: `tsc --noEmit` passes.
- [x] 4.2 Unit test `createRouter` auto-selection: with 3 models (0.5B no tools, 8B tools, 12B tools), assert classifier = smallest, fallback = largest with tools. Verify: `npm test` passes.
- [x] 4.3 Unit test `createRouter` returns `null` when models array is empty or has 1 entry. Verify: `npm test` passes.
- [x] 4.4 Unit test `createRouter` `route()` method: classifier returns a valid model → `source="classifier"`. Classifier returns `null` (timeout/unrecognized) → `source="fallback"`, correct `reason`. Verify: `npm test` passes.
- [x] 4.5 Unit test `createRouter` with manual overrides (`classifierModel` and `fallbackModel` set) uses them instead of auto-selection. Verify: `npm test` passes.

## 5. Orchestrator Integration

- [x] 5.1 Update `src/orchestrator.ts` `createMessageHandler` to accept an optional `router?: Router` dep. When provided, call `router.route(message.text)` before `runLoop`, pass the selected model to `runLoop` deps, and call `statsRecorder?.recordLlmCall()` with `role="classifier"` and the classifier usage. When `undefined`, behavior is unchanged (no classifier call, connector default model used). Verify: `tsc --noEmit` passes.
- [x] 5.2 Update `src/index.ts` to call `discoverModels` at startup, create a router via `createRouter`, and pass it to `createMessageHandler`. Log the discovered models and auto-selected classifier/fallback. Verify: `tsc --noEmit` passes.
- [x] 5.3 Update orchestrator tests: add test for routing (router returns model → `runLoop` receives it), test for no router (undefined → unchanged behavior), test for router fallback (classifier fails → fallback model used, `source="fallback"` recorded). Verify: `npm test` passes.

## 6. Config

- [x] 6.1 Update `src/config.ts` to add `classifierModel` (env `CLASSIFIER_MODEL`, default empty = auto), `classifierTimeoutMs` (env `CLASSIFIER_TIMEOUT_MS`, default 5000), `routerFallbackModel` (env `ROUTER_FALLBACK_MODEL`, default empty = auto). Add pure resolver functions and unit test them. Verify: config tests pass.

## 7. Documentation

- [x] 7.1 Update `.env.example` with `CLASSIFIER_MODEL`, `CLASSIFIER_TIMEOUT_MS`, `ROUTER_FALLBACK_MODEL` and their defaults. Note that empty values mean auto-selection. Verify: file contains all new vars.
- [x] 7.2 Update `README.md` — add a "Model Routing" section documenting: dynamic discovery via Ollama, classifier-based routing, auto-selection logic, env vars, and how to observe routing decisions in stats (`role="classifier"` rows). Verify: README reflects the new functionality.

## 8. Final Verification

- [x] 8.1 Run `npm test` and confirm all tests pass. Verify: `npm test` exits 0.
- [x] 8.2 Run `tsc --noEmit`. Verify: no type errors.

## 9. Thinking Mode & Explicit Classifier Default

- [x] 9.1 Add an optional `think?: boolean` field to `LlmRequest` in `src/llm/types.ts`. Update `OllamaConnector` (`src/llms/ollama/index.ts`) to include `think: request.think` in the `/api/chat` request body when `request.think !== undefined`; omit it otherwise (unchanged behavior for the main loop, which never sets it). Verify: `tsc --noEmit` passes.
- [x] 9.2 Update `classifyModel` (`src/routing/classifier.ts`) to always set `think: false` on the `LlmRequest` it builds. Verify: `tsc --noEmit` passes.
- [x] 9.3 Unit test: `OllamaConnector` includes `think: false` in the request body when `request.think === false`, and omits the `think` key entirely when `request.think` is unset. Verify: `npm test` passes.
- [x] 9.4 Unit test: `classifyModel`'s request to `callLlm` always has `think: false` set, regardless of input. Verify: `npm test` passes.
- [x] 9.5 Set `CLASSIFIER_MODEL=qwen3:1.7b` explicitly in `.env.example` (replacing the empty default), with a comment noting it's a small, text-only Qwen3 model chosen as a router/classifier trade-off, and that leaving it empty still auto-selects the smallest discovered model. Verify: file reflects the new default.
- [x] 9.6 Update `README.md`'s Model Routing section (and the env var table's `CLASSIFIER_MODEL` row) to mention the `think: false` behavior for classifier calls and the `qwen3:1.7b` recommended default. Verify: README reflects the new functionality.
- [x] 9.7 Run `npm test` and `tsc --noEmit`. Verify both pass.

## 10. Classifier Response Matching Robustness

- [x] 10.1 Update the matching logic in `classifyModel` (`src/routing/classifier.ts`): keep the existing exact-match check as the fast path; if it finds no match, check whether the trimmed response starts with a known model name, and if more than one model name is a valid prefix, pick the longest one. Only treat the response as unrecognized if neither step matches. Verify: `tsc --noEmit` passes.
- [x] 10.2 Unit test `classifyModel` with a fake `callLlm` returning `"qwen3.5:0.8b (0.87B params, supports tools)"` (a known model name followed by trailing text) — assert it returns `{ model: "qwen3.5:0.8b" }`. Verify: `npm test` passes.
- [x] 10.3 Unit test `classifyModel` with two candidate models where one name is a prefix of the other (e.g. `qwen3` and `qwen3.5:0.8b`) and the response is `"qwen3.5:0.8b is best"` — assert the longer name (`qwen3.5:0.8b`) is chosen, not the shorter prefix. Verify: `npm test` passes.
- [x] 10.4 Regression unit test `classifyModel` with a response that doesn't start with any known model name (e.g. `"gpt-4"`) — assert it still returns `{ model: null }` (existing unrecognized behavior preserved). Verify: `npm test` passes.
- [x] 10.5 Run `npm test` and `tsc --noEmit`. Verify both pass.

## 11. Classifier Call Latency Recording

- [x] 11.1 In `src/orchestrator.ts`'s `createMessageHandler`, measure elapsed time around the `deps.router.route(prompt)` call (`Date.now()` before/after, same pattern `runLoop` uses for `role="main"` calls) and pass it as `durationMs` in the `statsRecorder?.recordLlmCall({ role: "classifier", ... })` call. Verify: `tsc --noEmit` passes.
- [x] 11.2 Unit test: when a router is provided, the `recordLlmCall` stats entry with `role="classifier"` has a `durationMs` greater than or equal to 0 (use a fake router with an artificial delay, or assert the field is present and is a number). Verify: `npm test` passes.
- [x] 11.3 Run `npm test` and `tsc --noEmit`. Verify both pass.
