## Why

The Ollama connector corrupts the conversation it sends to the model, in two independent ways:

1. **The latest user turn is sent twice, in the wrong place.** `runLoop` builds every request with both `prompt` (the latest user text) and `messages` (the full conversation, which already ends with that same user turn). The connector prepends `prompt` as a fresh `user` message and then appends all of `messages`, so the model receives the current question first, then the history that repeats it. Every inference call therefore pays for the question twice and sees a conversation whose turns are out of order.
2. **Tool results arrive anonymous.** A `tool`-role message carries the name of the tool that produced it, but the connector drops that field when mapping to Ollama's wire format. When an iteration executes several tool calls, the model receives a run of unlabelled results and cannot tell which came from which tool.

3. **Tool definitions are sent in a shape Ollama cannot read, so tool calling never works.** The registry emits definitions flat (`{name, description, parameters}`) and the connector forwards them unchanged as `body.tools`. Ollama's chat API expects the OpenAI-compatible wrapper `{type: "function", function: {name, description, parameters}}`. It accepts the flat form without an error, but the model then sees tools whose names are empty and returns a call with `name: ""`. Measured against a running Ollama 
 with `qwen3:4b`: the wrapped form returned `{"name": "execute_command", "arguments": {"command": "uname -a"}}`, while the flat form the bot actually sends returned `{"name": "", "arguments": {"command": "uname -a"}}` — same model, same prompt, arguments correct in both, name lost only in the flat form. Downstream this surfaces as `Tool call executed { toolCalls: [ '' ], results: [ { name: '', ok: false } ] }` and a reply along the lines of "the tool is not registered", so the think → act → observe loop never reaches its act step.

All three are defects against the existing `llm-inference` requirement "Connector accepts conversation history for tool-use loops", which already mandates an *ordered* list of conversation messages. This is fixed now, before any token-consumption baseline is measured, so the baseline reflects a correct implementation rather than a known defect.

## What Changes

- The connector builds its wire-format message list from `messages` alone when history is present, preserving the caller's order and adding nothing. `prompt` is used only as a fallback, when `messages` is absent or empty, to form the single `user` message — so the no-history path is unchanged.
- The connector carries a tool result's tool name through to the provider, so each result is attributable to the tool that produced it.
- The connector wraps each tool definition in the form Ollama documents, instead of forwarding the interface's flat shape. The interface itself (`ToolDefinition`) is unchanged — the translation belongs to the connector, since it is what knows the provider's wire format.

Neither change alters the connector contract (`LlmRequest`/`LlmResult` are untouched) or any caller. `runLoop` keeps sending both `prompt` and `messages`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `llm-inference`: the "Standardized connector interface" requirement gains the obligation to translate tool definitions into the provider's shape; the "Connector accepts conversation history for tool-use loops" requirement is tightened to state that the request sent to the provider reproduces the caller's conversation exactly once and in order, and that a tool result identifies its tool.

## Impact

- `src/llms/ollama/index.ts` — `buildMessages()`, `toOllamaMessage()`, and the `tools` field of the request body.
- `test/llms/ollama.test.ts` — new cases using the existing fake-`fetch` pattern.
- No caller changes: the registry keeps emitting flat definitions and `runLoop` keeps passing them through.
- No schema, config, or env changes. No other connector is affected (`stub` is text-only and ignores history).
- Expected side effect: a measurable drop in input tokens per call, growing with conversation length. This is a correctness fix, not one of the optimizations counted in the later token-optimization work — it lands before the baseline is taken.
