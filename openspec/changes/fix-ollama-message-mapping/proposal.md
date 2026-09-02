## Why

The Ollama connector corrupts the conversation it sends to the model, in two independent ways:

1. **The latest user turn is sent twice, in the wrong place.** `runLoop` builds every request with both `prompt` (the latest user text) and `messages` (the full conversation, which already ends with that same user turn). The connector prepends `prompt` as a fresh `user` message and then appends all of `messages`, so the model receives the current question first, then the history that repeats it. Every inference call therefore pays for the question twice and sees a conversation whose turns are out of order.
2. **Tool results arrive anonymous.** A `tool`-role message carries the name of the tool that produced it, but the connector drops that field when mapping to Ollama's wire format. When an iteration executes several tool calls, the model receives a run of unlabelled results and cannot tell which came from which tool.

Both are defects against the existing `llm-inference` requirement "Connector accepts conversation history for tool-use loops", which already mandates an *ordered* list of conversation messages. This is fixed now, before any token-consumption baseline is measured, so the baseline reflects a correct implementation rather than a known defect.

## What Changes

- The connector builds its wire-format message list from `messages` alone when history is present, preserving the caller's order and adding nothing. `prompt` is used only as a fallback, when `messages` is absent or empty, to form the single `user` message — so the no-history path is unchanged.
- The connector carries a tool result's tool name through to the provider, so each result is attributable to the tool that produced it.

Neither change alters the connector contract (`LlmRequest`/`LlmResult` are untouched) or any caller. `runLoop` keeps sending both `prompt` and `messages`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `llm-inference`: the "Connector accepts conversation history for tool-use loops" requirement is tightened to state that the request sent to the provider reproduces the caller's conversation exactly once and in order, and that a tool result identifies its tool.

## Impact

- `src/llms/ollama/index.ts` — `buildMessages()` and `toOllamaMessage()`.
- `test/llms/ollama.test.ts` — new cases using the existing fake-`fetch` pattern.
- No schema, config, or env changes. No other connector is affected (`stub` is text-only and ignores history).
- Expected side effect: a measurable drop in input tokens per call, growing with conversation length. This is a correctness fix, not one of the optimizations counted in the later token-optimization work — it lands before the baseline is taken.
