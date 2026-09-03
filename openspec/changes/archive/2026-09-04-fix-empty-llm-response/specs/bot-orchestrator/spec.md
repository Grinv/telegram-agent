## MODIFIED Requirements

### Requirement: Reply reflects inference outcome
The system SHALL send the LLM's final response back to the user when the think → act → observe loop completes successfully, and SHALL send a user-facing error notice when inference fails (not configured, provider error, or timeout), when the LLM's response is empty and requests no tool call, or when an unexpected tool execution error prevents completion.

#### Scenario: Successful inference
- **WHEN** the LLM produces a final text response (either directly or after one or more tool-use iterations) for a user's message
- **THEN** the orchestrator sends that response back to the same chat

#### Scenario: Failed inference
- **WHEN** the LLM connector reports a failure (not configured, error, or timeout) for a user's message
- **THEN** the orchestrator sends a user-facing message indicating the request could not be completed, instead of leaving the user without any reply

#### Scenario: Tool execution fails
- **WHEN** a tool execution fails during the loop
- **THEN** the failure is fed back to the LLM as an observation so the LLM can attempt an alternative approach, and only if the loop cannot recover does the user receive a failure notice

#### Scenario: LLM returns an empty response with no tool call
- **WHEN** the LLM connector reports success but the response text is empty (or contains only whitespace) and requests no tool call
- **THEN** the orchestrator treats this as a failed exchange, sends the user-facing failure notice instead of attempting to deliver empty text, and never calls the message delivery step with an empty reply
