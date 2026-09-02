## MODIFIED Requirements

### Requirement: Standardized connector interface
The system SHALL expose every LLM inference provider through the same interface, accepting a request (containing the prompt, optional conversation messages, optional tool definitions, and an optional model override) and returning a response (containing either text or tool-call requests, and optional token-usage metadata), so callers do not need to know which provider is active.

#### Scenario: Swapping providers requires no caller changes
- **WHEN** the active connector is changed from one provider to another
- **THEN** the code that requests an LLM response continues to work unmodified

#### Scenario: LLM returns a tool-call request
- **WHEN** the connector is invoked with tool definitions and the LLM decides to call a tool
- **THEN** the result contains the tool name(s) and argument(s) the LLM requested, so the orchestrator can execute them and feed the results back

#### Scenario: LLM returns a final text answer
- **WHEN** the connector is invoked (with or without tool definitions) and the LLM produces a final text response
- **THEN** the result contains that text and no tool-call requests

#### Scenario: Model override is passed through
- **WHEN** the inference request includes a `model` field
- **THEN** the connector uses that model instead of its default configured model, so the caller can select a specific model per call

#### Scenario: Token usage is reported when available
- **WHEN** the provider's response includes token-count metadata (e.g. prompt evaluation count, completion token count)
- **THEN** the result includes a `usage` field with the token counts, so downstream consumers can record real usage without estimating

## ADDED Requirements

### Requirement: Connector accepts conversation history for tool-use loops
The system SHALL accept an ordered list of conversation messages (user, assistant, tool-result) in the inference request, so the think → act → observe loop can pass prior tool results back to the LLM for multi-step reasoning within a single message's handling.

#### Scenario: Second iteration includes prior tool result
- **WHEN** the orchestrator sends a follow-up request after executing a tool call
- **THEN** the request includes the original user message, the LLM's tool-call response, and the tool's result as conversation history, and the LLM can use all of it to produce its next response

### Requirement: Stub connector is text-only
The system SHALL provide a stub inference connector that returns a deterministic placeholder text response and never returns tool-call requests, for use while no real LLM provider is connected. When invoked with tool definitions, the stub connector SHALL ignore them and return text. The stub connector SHALL NOT report token usage (the `usage` field is absent).

#### Scenario: Stub responds without an external LLM
- **WHEN** the stub connector is invoked with a prompt and tool definitions
- **THEN** it returns a placeholder text response without making any network call to an external LLM service, the response contains no tool-call requests, and no `usage` field is present
