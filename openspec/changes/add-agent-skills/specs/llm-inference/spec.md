## ADDED Requirements

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
