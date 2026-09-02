## Context

See proposal.md — Why. After changes 1 and 2:
- `LlmRequest` has an optional `model?` field (change 1).
- `OllamaConnector` passes `request.model ?? this.model` to the `/api/chat` body (change 1).
- `runLoop` accepts a `model?` in its deps and passes it to `LlmRequest.model` (change 1).
- `StatsRecorder.recordLlmCall` accepts a `role` field; change 2 records `role="main"`.
- The orchestrator has `statsRecorder?.recordLlmCall()` hook points (change 1).

This change adds: (1) model discovery from Ollama at startup, (2) a classifier that picks a model per message, (3) integration into the orchestrator. The orchestrator loop itself (`runLoop`) is not modified — only the code before it (classify → set `model` → pass to `runLoop`).

## Goals / Non-Goals

**Goals:**
- Dynamic model discovery (no `models.json`, no hardcoded list — Ollama is the source of truth).
- LLM-based classification (semantics, not length/keywords).
- Auto-selection of classifier and fallback models (zero config when possible).
- Graceful degradation (fallback on any classifier failure).
- Stats integration (routing decisions and classifier token usage recorded).

**Non-Goals:**
- Custom routing rules or user-defined model selection logic — the classifier LLM decides.
- Hot-reloading of models — discovery happens at startup only; restart after `ollama pull`.
- Routing for non-Ollama providers — discovery is Ollama-specific; other providers use their default model.
- Modifying `runLoop` — routing happens before the loop, not inside it.

## Decisions

### 1. Model discovery: `/api/tags` + `/api/show`

```
GET /api/tags
  → { models: [{ name, details: { family, parameter_size, quantization_level } }] }

For each model:
  POST /api/show { name: "..." }
  → { capabilities: ["completion", "tools"?], details: { family, parameter_size } }
```

`/api/tags` gives the list; `/api/show` gives capabilities (including `"tools"`). Both are fetched with `fetch` (injectable `fetchImpl` for testing). Discovery makes N+1 HTTP calls (1 for tags, N for show) — this happens once at startup, not per message.

- Alternative considered: hardcode a model list in config — rejected; the user explicitly asked for dynamic discovery via Ollama queries, and a static list would drift from what's actually pulled.
- Alternative considered: query `/api/show` on-demand (lazy, per message) — rejected; adds latency to every message and N calls per message instead of once at startup.

### 2. `ModelEntry` structure

```
ModelEntry = {
  name: string               // "llama3.1:8b"
  parameterSize: number       // 8 (parsed from "8B" → 8, for comparison)
  family: string              // "llama"
  supportsTools: boolean      // true if capabilities includes "tools"
}
```

`parameter_size` from Ollama is a string like `"8B"`, `"0.5B"`, `"13B"`. We parse it to a number (`8`, `0.5`, `13`) for size-based comparison. If parsing fails, default to `0` (treated as smallest).

### 3. Classifier prompt

```
You are a model router. Given a user message and a list of available models,
pick the most suitable model.

User message: "<message text>"

Available models:
1. qwen2.5:0.5b (0.5B params, no tools)
2. llama3.1:8b (8B params, supports tools)
3. mistral-nemo (12B params, supports tools)

Guidelines:
- Simple greetings, basic math, short answers → small model
- Code generation, complex reasoning, multi-step tasks → large model
- If tools are needed (the user asks to execute commands, read/write files),
  pick a model that supports tools

Respond with ONLY the model name, nothing else.
```

The classifier uses `callLlm` (the same forked-child-process isolation). The classifier call is a regular `LlmRequest` with `model: classifierModel` and no `tools` (classification is text-in, text-out).

The classifier request also sets `think: false`. Newer Ollama models (e.g. the Qwen3 line) support a "thinking" mode that prepends a reasoning trace to the response; if the raw response were parsed with an exact match, any text beyond the bare model name would make classification fail closed to the fallback model. `LlmRequest` gains an optional `think?: boolean` field for this (unset = provider default; the main loop never sets it, so its behavior is unchanged), and `OllamaConnector` forwards it as `think` in the `/api/chat` body when present.

**Response matching is two-step, not a single exact match.** Live testing against a real Ollama instance showed that even with `think: false`, a model doesn't reliably follow "respond with ONLY the model name" — a small model (`qwen2.5:0.5b`) responded `"qwen3.5:0.8b (0.87B params, supports tools)"` instead of the bare name. `classifyModel` therefore: (1) trims the response and checks for an exact match against `models[].name` (the fast, unambiguous path for well-behaved models); (2) if that fails, checks whether the trimmed response *starts with* a known model name, preferring the longest matching name if more than one is a valid prefix (avoids one model name being a prefix of another causing a wrong pick). Only if neither step matches is the response treated as unrecognized.

### 4. Auto-selection logic

```
classifierModel = env.CLASSIFIER_MODEL ?? models.filter(m => true).sort(bySizeAsc)[0].name
fallbackModel    = env.ROUTER_FALLBACK_MODEL ?? models.filter(m => m.supportsTools).sort(bySizeDesc)[0].name
                   ?? models.sort(bySizeDesc)[0].name  // if no tool-capable, largest overall
```

`.env.example` ships `CLASSIFIER_MODEL=qwen3:1.7b` as an explicit default rather than leaving it empty. Auto-selecting the smallest discovered model is a reasonable default in principle, but in practice it can pick something unsuitable — e.g. a multimodal model kept around for other purposes, or a model too weak to classify reliably. `qwen3:1.7b` is a small, text-only (non-multimodal, so no vision-encoder memory overhead) Qwen3 model chosen as a good speed/accuracy trade-off for routing specifically. Auto-selection (smallest discovered model) remains the behavior whenever `CLASSIFIER_MODEL` is unset — this is a change to the shipped default value, not to the auto-selection logic itself.

If only one model is discovered, `classifierModel` and `fallbackModel` are both that model — and routing is skipped entirely (no point classifying when there's only one option).

### 5. Router interface

```
Router = {
  route(message: string): Promise<RoutingDecision>
}

RoutingDecision = {
  model: string                                    // selected model name
  source: "classifier" | "fallback"                // how the decision was made
  reason?: string                                  // "timeout" | "unrecognized" | "classifier_error" | "single_model" | "no_models"
  classifierUsage?: TokenUsage                     // token counts from the classifier call (for stats)
}
```

The orchestrator calls `router.route(message.text)` before `runLoop`. The `RoutingDecision.classifierUsage` is passed to `statsRecorder.recordLlmCall` with `role="classifier"` so the user sees classifier token costs in the stats report.

### 6. Orchestrator integration

```
createMessageHandler(deps):
  return async (message):
    statsRecorder?.recordMessage({ ... })
    
    // NEW: routing (if router is provided)
    let model: string | undefined
    if (deps.router) {
      const startedAt = Date.now()
      decision = await deps.router.route(message.text)
      const durationMs = Date.now() - startedAt
      model = decision.model
      statsRecorder?.recordLlmCall({ role: "classifier", model: decision.classifierModel, usage: decision.classifierUsage, durationMs, ... })
      logger.info("Routing decision", { model, source: decision.source, reason: decision.reason })
    }
    
    result = runLoop(messages, tools, { ...deps, model })
    // rest unchanged
```

When `deps.router` is `undefined` (not wired), behavior is identical to change 1 — the connector's default model is used. This makes routing fully optional.

### 7. Classifier timeout

The classifier uses a separate timeout (`CLASSIFIER_TIMEOUT_MS`, default 5000ms) shorter than `LLM_TIMEOUT_MS` (default 15000ms). Rationale: classification should be fast; if it's not, the fallback is used, and the user shouldn't wait 15s for a routing decision before the actual LLM call even starts.

### 8. Stats: `role="classifier"`

The classifier LLM call is recorded in `llm_calls` with `role="classifier"`, including its measured latency (`Date.now()` around `router.route()`, same pattern `runLoop` already uses for `role="main"` calls) — without this, `stats:report`'s per-model latency breakdown would show 0ms for the classifier's row, understating a model's real average latency whenever it's used as both classifier and a routed model. The main loop calls use `role="main"` (from change 2). This lets the stats report show:

```sql
-- Tokens spent on classification vs. main loop
SELECT role, SUM(prompt_tokens + completion_tokens) AS tokens
FROM llm_calls GROUP BY role;
```

## Risks / Trade-offs

- [Classifier adds latency (one extra LLM call per message)] → Accepted; the classifier model is the smallest available, so it's fast (~200–500ms). For simple messages, the savings from using a small model for the main call outweigh the classifier overhead. For complex messages, the classifier overhead is negligible compared to the large model's latency.
- [Classifier may make wrong choices] → Accepted; the fallback model is always available, and the user can observe routing decisions in stats and adjust `CLASSIFIER_MODEL` or `ROUTER_FALLBACK_MODEL` if needed.
- [`/api/show` call count = N at startup] → Accepted; happens once at startup, not per message. For 5 models, that's 6 HTTP calls total, taking <1s.
- [Ollama API changes] → Low risk; `/api/tags` and `/api/show` are stable Ollama endpoints. If they change, `model-discovery.ts` is isolated and can be updated without touching the orchestrator.

## Open Questions

(none)
