## Purpose

Routes each incoming message to the best-fitting LLM model by dynamically discovering available models from Ollama at startup and using a small classifier LLM to select the model per message — so simple messages go to fast/cheap models and complex ones to capable/expensive models, reducing token cost and latency.

## ADDED Requirements

### Requirement: Available models are discovered from Ollama at startup
The system SHALL query Ollama's `/api/tags` endpoint at startup to discover all locally available models, and SHALL query `/api/show` for each model to determine its capabilities (including tool-call support), parameter size, and family. The discovered model list SHALL be cached in memory for the process lifetime.

#### Scenario: Startup with multiple models pulled
- **WHEN** the bot starts and Ollama has `qwen2.5:0.5b`, `llama3.1:8b`, and `mistral-nemo` pulled
- **THEN** the system builds a registry of three models, each with its parameter size, family, and whether it supports tool calling, by querying `/api/tags` followed by `/api/show` for each

#### Scenario: Ollama unreachable at startup
- **WHEN** the bot starts and Ollama is not running or unreachable
- **THEN** the system logs a warning, skips routing (all messages use the connector's default model), and continues startup — does not crash

### Requirement: Classifier model is auto-selected as the smallest available
The system SHALL automatically select the model with the smallest parameter size as the classifier model, unless overridden by the `CLASSIFIER_MODEL` environment variable. This ensures the cheapest model is used for the classification decision itself.

#### Scenario: Auto-selection with multiple models
- **WHEN** `CLASSIFIER_MODEL` is not set and the discovered models include `qwen2.5:0.5b` (0.5B), `llama3.1:8b` (8B), and `mistral-nemo` (12B)
- **THEN** the classifier model is `qwen2.5:0.5b` (the smallest)

#### Scenario: Manual override
- **WHEN** `CLASSIFIER_MODEL` is set to `llama3.1:8b`
- **THEN** the classifier model is `llama3.1:8b`, regardless of parameter sizes

### Requirement: Fallback model is auto-selected as the largest tool-capable model
The system SHALL automatically select the largest model that supports tool calling as the fallback model (used when the classifier fails or returns an unrecognized name), unless overridden by the `ROUTER_FALLBACK_MODEL` environment variable.

#### Scenario: Auto-selection with tool-capable models
- **WHEN** `ROUTER_FALLBACK_MODEL` is not set and the discovered models include `qwen2.5:0.5b` (no tools, 0.5B) and `llama3.1:8b` (tools, 8B)
- **THEN** the fallback model is `llama3.1:8b` (the largest with tool support)

#### Scenario: No tool-capable models available
- **WHEN** no discovered model supports tool calling
- **THEN** the fallback model is the largest model overall (tool calling may fail at runtime, but routing still works for text-only responses)

### Requirement: Classifier selects the model for each message
The system SHALL call the classifier model with the user message text and a list of available models (with their metadata: name, parameter size, tool support) before entering the think → act → observe loop. The classifier SHALL return the name of the model that should handle the message. The selected model SHALL be passed to `runLoop` via `LlmRequest.model`.

#### Scenario: Simple message routed to small model
- **WHEN** the user sends "hello" and `qwen2.5:0.5b` is available
- **THEN** the classifier returns `qwen2.5:0.5b`, the loop uses that model, and the classifier call is recorded in stats with `role="classifier"`

#### Scenario: Complex message routed to large model
- **WHEN** the user sends "write a Python script to parse a CSV file and calculate statistics" and `llama3.1:8b` is available with tool support
- **THEN** the classifier returns `llama3.1:8b`, the loop uses that model, and the classifier call is recorded in stats with `role="classifier"`

### Requirement: Routing degrades gracefully on classifier failure
The system SHALL fall back to the fallback model when: the classifier call times out, the classifier returns a model name not in the registry, or the classifier call fails (Ollama error). The fallback decision SHALL be recorded in stats so the user can observe how often fallbacks occur.

#### Scenario: Classifier times out
- **WHEN** the classifier call does not complete within `CLASSIFIER_TIMEOUT_MS`
- **THEN** the system uses the fallback model, logs a warning, and records the routing decision as `source="fallback"` with `reason="timeout"` in stats

#### Scenario: Classifier returns unrecognized model name
- **WHEN** the classifier returns a string that does not match any model in the registry
- **THEN** the system uses the fallback model and records the routing decision as `source="fallback"` with `reason="unrecognized"`

#### Scenario: Classifier call fails
- **WHEN** the classifier LLM call returns a failure (`ok: false`)
- **THEN** the system uses the fallback model and records the routing decision as `source="fallback"` with `reason="classifier_error"`

### Requirement: Routing is optional and disabled when no models discovered
The system SHALL skip routing entirely (using the connector's default model) when model discovery returns an empty list or when only one model is available. When routing is skipped, no classifier LLM call is made.

#### Scenario: Single model available
- **WHEN** only one model is discovered from Ollama
- **THEN** no classifier call is made, and that model is used for all messages (the connector's default already points to it)

#### Scenario: No models available
- **WHEN** model discovery returns an empty list (Ollama running but no models pulled)
- **THEN** no classifier call is made, and the connector's default model is used (will fail at runtime with `PROVIDER_ERROR`, which is the existing behavior)
