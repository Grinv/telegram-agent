## MODIFIED Requirements

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
