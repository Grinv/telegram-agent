## Purpose

Defines a standardized, pluggable contract for invoking LLM inference providers, so new providers can be added without changing the code that calls them, and executes each call in isolation so failures don't affect the bot process.

## Requirements

### Requirement: Standardized connector interface
The system SHALL expose every LLM inference provider through the same interface, accepting a request (containing the prompt, optional conversation messages, optional tool definitions, and an optional model override) and returning a response (containing either text or tool-call requests, and optional token-usage metadata), so callers do not need to know which provider is active.

A connector SHALL translate the interface's tool definitions into the shape its provider expects, rather than forwarding them unchanged. A tool definition that reaches the provider in a shape it cannot read SHALL be treated as a defect, even when the provider accepts the request without error.

#### Scenario: Swapping providers requires no caller changes
- **WHEN** the active connector is changed from one provider to another
- **THEN** the code that requests an LLM response continues to work unmodified

#### Scenario: LLM returns a tool-call request
- **WHEN** the connector is invoked with tool definitions and the LLM decides to call a tool
- **THEN** the result contains the tool name(s) and argument(s) the LLM requested, so the orchestrator can execute them and feed the results back

#### Scenario: Tool definitions are translated for the provider
- **WHEN** the connector is invoked with tool definitions
- **THEN** each definition is sent in the shape the provider documents, so the provider can read the tool's name, and a returned tool call names the tool that was defined rather than an empty name

#### Scenario: LLM returns a final text answer
- **WHEN** the connector is invoked (with or without tool definitions) and the LLM produces a final text response
- **THEN** the result contains that text and no tool-call requests

#### Scenario: Model override is passed through
- **WHEN** the inference request includes a `model` field
- **THEN** the connector uses that model instead of its default configured model, so the caller can select a specific model per call

#### Scenario: Token usage is reported when available
- **WHEN** the provider's response includes token-count metadata (e.g. prompt evaluation count, completion token count)
- **THEN** the result includes a `usage` field with the token counts, so downstream consumers can record real usage without estimating

### Requirement: Stub connector when no provider is configured
The system SHALL provide a stub inference connector that returns a deterministic placeholder response, for use while no real LLM provider (e.g. Ollama) is connected.

#### Scenario: Stub responds without an external LLM
- **WHEN** the stub connector is invoked with a prompt
- **THEN** it returns a placeholder response without making any network call to an external LLM service

### Requirement: Inference runs isolated from the main process
The system SHALL execute each LLM inference call in a separate process from the main bot process.

#### Scenario: Inference crash does not affect the bot
- **WHEN** the inference process crashes or throws an unhandled error
- **THEN** the main bot process remains running and reports an inference failure for that request

### Requirement: Inference calls are bounded by a timeout
The system SHALL enforce a maximum wait time for each inference call and SHALL terminate the inference process if it exceeds that time. The configured timeout SHALL be the actual effective limit on how long a call may run — no shorter, undocumented limit internal to the connector's transport SHALL cause the call to fail before the configured timeout is reached.

#### Scenario: Inference hangs
- **WHEN** an inference call does not complete within the configured timeout
- **THEN** the system terminates the inference process and reports a timeout failure for that request instead of waiting indefinitely

#### Scenario: A slow but legitimate call outlasts a transport-internal default
- **WHEN** an inference call takes longer than a default timeout built into the connector's underlying HTTP transport, but less than the configured timeout
- **THEN** the call completes successfully and is not reported as a failure

### Requirement: Inference failures are reported, not thrown to the user unhandled
The system SHALL capture connector errors (not-configured, provider error, timeout) and surface them as a structured failure result rather than letting them crash the caller.

#### Scenario: Provider returns an error
- **WHEN** the active connector's underlying provider returns an error response
- **THEN** the system reports this as an inference failure with an identifiable reason, without exiting the process

### Requirement: Default connector is Ollama
The system SHALL use the `ollama` connector when `LLM_PROVIDER` is not explicitly set.

#### Scenario: No provider configured
- **WHEN** the system starts with no `LLM_PROVIDER` value set
- **THEN** the active connector is `ollama`

### Requirement: Startup fails fast on an unrecognized provider
The system SHALL validate `LLM_PROVIDER` at startup against the set of registered connectors and SHALL refuse to start with a clear configuration error if the value does not match any of them.

#### Scenario: Unknown provider name configured
- **WHEN** `LLM_PROVIDER` is set to a value that is not a registered connector name
- **THEN** the system fails to start with a clear configuration error instead of starting and only failing once a message is received

#### Scenario: Known provider name configured
- **WHEN** `LLM_PROVIDER` is set to a registered connector name (e.g. `stub` or `ollama`)
- **THEN** the system starts normally using that connector

### Requirement: Connector accepts conversation history for tool-use loops
The system SHALL accept an ordered list of conversation messages (user, assistant, tool-result) in the inference request, so the think → act → observe loop can pass prior tool results back to the LLM for multi-step reasoning within a single message's handling.

When the request carries a conversation history, the request the connector sends to the provider SHALL reproduce that history exactly once and in the caller's order, and SHALL NOT insert, duplicate, or reorder any turn. The request's separate latest-user-text field SHALL be used to form a message only when no conversation history is supplied.

A conversation message that carries a tool result SHALL be sent to the provider with the name of the tool that produced it, so the model can attribute each result to its tool.

#### Scenario: Second iteration includes prior tool result
- **WHEN** the orchestrator sends a follow-up request after executing a tool call
- **THEN** the request includes the original user message, the LLM's tool-call response, and the tool's result as conversation history, and the LLM can use all of it to produce its next response

#### Scenario: Conversation history is sent without duplication
- **WHEN** a request supplies both a conversation history ending in a user turn and the latest user text as a separate field
- **THEN** the provider receives exactly the messages of the conversation history, in the same order, with the latest user turn appearing once and last — the separate latest-user-text field adds no extra message

#### Scenario: Request without conversation history
- **WHEN** a request supplies the latest user text but no conversation history
- **THEN** the provider receives a single user message containing that text

#### Scenario: Tool result identifies its tool
- **WHEN** a request's conversation history contains results from two different tools executed in the same iteration
- **THEN** each result is sent to the provider labelled with the name of the tool that produced it, so the two results are distinguishable

### Requirement: Stub connector is text-only
The system SHALL provide a stub inference connector that returns a deterministic placeholder text response and never returns tool-call requests, for use while no real LLM provider is connected. When invoked with tool definitions, the stub connector SHALL ignore them and return text. The stub connector SHALL NOT report token usage (the `usage` field is absent).

#### Scenario: Stub responds without an external LLM
- **WHEN** the stub connector is invoked with a prompt and tool definitions
- **THEN** it returns a placeholder text response without making any network call to an external LLM service, the response contains no tool-call requests, and no `usage` field is present

### Requirement: Connector accepts a system instruction message
The system SHALL support a system instruction message in the inference request, distinct from the user, assistant, and tool-result messages, and SHALL pass it to the provider as an instruction rather than as user input. A request without a system instruction SHALL behave exactly as before.

A connector that has no notion of a system instruction SHALL still accept the request and produce a result, rather than rejecting it.

#### Scenario: Request carries a system instruction
- **WHEN** a request supplies a system instruction alongside the conversation
- **THEN** the provider receives it as an instruction, separate from the user's turn, and the user's turn is unchanged

#### Scenario: Request carries no system instruction
- **WHEN** a request supplies no system instruction
- **THEN** the provider receives the conversation exactly as it would have before system instructions were supported

#### Scenario: Connector without system-instruction support
- **WHEN** a request carrying a system instruction is sent to a connector that does not distinguish instructions from other input
- **THEN** the connector still returns a result rather than failing the request

### Requirement: Inference requests may specify deterministic sampling
The system SHALL allow an inference request to specify sampling controls that make generation as reproducible as the provider supports, and SHALL pass them to the provider when supplied. A request that supplies none SHALL behave exactly as before, using the provider's defaults.

A connector whose provider does not support such controls SHALL ignore them and still return a result, rather than failing the request.

#### Scenario: Request specifies deterministic sampling
- **WHEN** a request supplies sampling controls for reproducible generation
- **THEN** the provider receives them alongside the request

#### Scenario: Request specifies no sampling controls
- **WHEN** a request supplies no sampling controls
- **THEN** the provider receives the request exactly as it would have before this capability existed

#### Scenario: Connector without sampling support
- **WHEN** a request supplying sampling controls is sent to a connector whose provider does not support them
- **THEN** the connector ignores them and returns a result rather than failing
</content>
