## MODIFIED Requirements

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
