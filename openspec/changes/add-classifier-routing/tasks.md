## 1. Types

- [ ] 1.1 Create `src/routing/types.ts` defining `ModelEntry` (`{ name: string, parameterSize: number, family: string, supportsTools: boolean }`), `RoutingDecision` (`{ model: string, source: "classifier" | "fallback", reason?: string, classifierModel: string, classifierUsage?: TokenUsage }`), and `Router` interface (`{ route(message: string): Promise<RoutingDecision> }`). Import `TokenUsage` from `src/llm/types.ts`. Verify: `tsc --noEmit` passes.

## 2. Model Discovery

- [ ] 2.1 Create `src/routing/model-discovery.ts` — `discoverModels(ollamaBaseUrl: string, fetchImpl: typeof fetch): Promise<ModelEntry[]>`. Calls `GET /api/tags` to get the model list, then `POST /api/show` for each model to get `capabilities` and `details`. Parses `parameter_size` string ("8B" → 8, "0.5B" → 0.5) to a number. Returns an empty array on fetch failure (logs warning, does not throw). Verify: `tsc --noEmit` passes.
- [ ] 2.2 Unit test `discoverModels` with a fake `fetchImpl` returning a `/api/tags` response with 3 models and `/api/show` responses with varying capabilities (one with tools, one without, one with missing capabilities). Assert the returned `ModelEntry[]` has correct names, parameter sizes, and `supportsTools` flags. Verify: `npm test` passes.
- [ ] 2.3 Unit test `discoverModels` returns an empty array when `/api/tags` fetch fails (network error, non-OK HTTP status, malformed JSON). Verify: no throw, empty array returned, `npm test` passes.
- [ ] 2.4 Unit test `discoverModels` handles malformed `parameter_size` (e.g. "unknown") by defaulting to `0`. Verify: `npm test` passes.

## 3. Classifier

- [ ] 3.1 Create `src/routing/classifier.ts` — `classifyModel(message: string, models: ModelEntry[], deps: { callLlm: CallLlm, classifierModel: string, timeoutMs: number }): Promise<{ model: string | null, usage?: TokenUsage }>`. Builds the classifier prompt (message + model list with metadata), calls `callLlm({ prompt, model: classifierModel })`, parses the response text as a model name (trim, match against `models[].name`). Returns `{ model: null, usage }` if the response doesn't match any model name. Returns `{ model: null }` if `callLlm` fails or times out. Verify: `tsc --noEmit` passes.
- [ ] 3.2 Unit test `classifyModel` with a fake `callLlm` returning `"llama3.1:8b"` — assert it returns `{ model: "llama3.1:8b" }`. Verify: `npm test` passes.
- [ ] 3.3 Unit test `classifyModel` with a fake `callLlm` returning an unrecognized string (e.g. `"gpt-4"`) — assert it returns `{ model: null }`. Verify: `npm test` passes.
- [ ] 3.4 Unit test `classifyModel` with a fake `callLlm` returning a failure (`{ ok: false }`) — assert it returns `{ model: null }` without throwing. Verify: `npm test` passes.
- [ ] 3.5 Unit test `classifyModel` with a fake `callLlm` returning text with extra whitespace/newlines — assert it trims and matches. Verify: `npm test` passes.

## 4. Router Factory

- [ ] 4.1 Create `src/routing/index.ts` — `createRouter(deps: { models: ModelEntry[], callLlm: CallLlm, classifierModel?: string, fallbackModel?: string, classifierTimeoutMs?: number }): Router | null`. Auto-selects classifier (smallest) and fallback (largest with tools, or largest overall). Returns `null` if models has 0 or 1 entries (routing skipped). Returns a `Router` object whose `route(message)` method calls `classifyModel`, applies fallback logic on `null`, and returns a `RoutingDecision` with `source` and `reason`. Verify: `tsc --noEmit` passes.
- [ ] 4.2 Unit test `createRouter` auto-selection: with 3 models (0.5B no tools, 8B tools, 12B tools), assert classifier = smallest, fallback = largest with tools. Verify: `npm test` passes.
- [ ] 4.3 Unit test `createRouter` returns `null` when models array is empty or has 1 entry. Verify: `npm test` passes.
- [ ] 4.4 Unit test `createRouter` `route()` method: classifier returns a valid model → `source="classifier"`. Classifier returns `null` (timeout/unrecognized) → `source="fallback"`, correct `reason`. Verify: `npm test` passes.
- [ ] 4.5 Unit test `createRouter` with manual overrides (`classifierModel` and `fallbackModel` set) uses them instead of auto-selection. Verify: `npm test` passes.

## 5. Orchestrator Integration

- [ ] 5.1 Update `src/orchestrator.ts` `createMessageHandler` to accept an optional `router?: Router` dep. When provided, call `router.route(message.text)` before `runLoop`, pass the selected model to `runLoop` deps, and call `statsRecorder?.recordLlmCall()` with `role="classifier"` and the classifier usage. When `undefined`, behavior is unchanged (no classifier call, connector default model used). Verify: `tsc --noEmit` passes.
- [ ] 5.2 Update `src/index.ts` to call `discoverModels` at startup, create a router via `createRouter`, and pass it to `createMessageHandler`. Log the discovered models and auto-selected classifier/fallback. Verify: `tsc --noEmit` passes.
- [ ] 5.3 Update orchestrator tests: add test for routing (router returns model → `runLoop` receives it), test for no router (undefined → unchanged behavior), test for router fallback (classifier fails → fallback model used, `source="fallback"` recorded). Verify: `npm test` passes.

## 6. Config

- [ ] 6.1 Update `src/config.ts` to add `classifierModel` (env `CLASSIFIER_MODEL`, default empty = auto), `classifierTimeoutMs` (env `CLASSIFIER_TIMEOUT_MS`, default 5000), `routerFallbackModel` (env `ROUTER_FALLBACK_MODEL`, default empty = auto). Add pure resolver functions and unit test them. Verify: config tests pass.

## 7. Documentation

- [ ] 7.1 Update `.env.example` with `CLASSIFIER_MODEL`, `CLASSIFIER_TIMEOUT_MS`, `ROUTER_FALLBACK_MODEL` and their defaults. Note that empty values mean auto-selection. Verify: file contains all new vars.
- [ ] 7.2 Update `README.md` — add a "Model Routing" section documenting: dynamic discovery via Ollama, classifier-based routing, auto-selection logic, env vars, and how to observe routing decisions in stats (`role="classifier"` rows). Verify: README reflects the new functionality.

## 8. Final Verification

- [ ] 8.1 Run `npm test` and confirm all tests pass. Verify: `npm test` exits 0.
- [ ] 8.2 Run `tsc --noEmit`. Verify: no type errors.
