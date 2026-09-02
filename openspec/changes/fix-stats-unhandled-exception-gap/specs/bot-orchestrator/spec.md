## MODIFIED Requirements

### Requirement: Stats recording is optional and injectable
The system SHALL accept an optional `statsRecorder` dependency in the orchestrator. When `statsRecorder` is `undefined`, the loop SHALL operate normally without recording any statistics. When a `statsRecorder` is provided, the loop SHALL report timing, iteration count, tool call count, and LLM call results to it at defined hook points (message received, each LLM call, each tool call, reply sent). This holds on every code path that ends in a reply to the user, including an unexpected internal error, not only the typed loop success/failure outcomes. The orchestrator SHALL depend only on the stats recorder interface, not on any specific implementation.

#### Scenario: No stats recorder provided
- **WHEN** the orchestrator is created without a `statsRecorder` dependency
- **THEN** the loop runs normally and no statistics are recorded, and no errors or warnings are emitted about the missing recorder

#### Scenario: Stats recorder provided
- **WHEN** the orchestrator is created with a `statsRecorder` dependency
- **THEN** at each hook point (message received, LLM call completed, tool call completed, reply sent), the recorder receives the relevant timing and count data

#### Scenario: Stats recorder provided and an unexpected error occurs
- **WHEN** an unexpected internal error occurs while handling a message and a `statsRecorder` is provided
- **THEN** the recorder still receives the reply-sent hook data for that message, marked as failed with a reason identifying the error, instead of never being told the message finished
