## MODIFIED Requirements

### Requirement: Tool execution results are structured
The system SHALL return the outcome of each tool call as a structured result containing at minimum a success/failure flag, stdout or output content, and an error message when the tool failed, so the orchestrator can feed the result back to the LLM in a consistent format. This applies even when the requested tool name is not registered: the system SHALL NOT let that failure propagate as an unhandled error out of the sandbox executor, and other tool calls in the same batch SHALL still be attempted.

A result whose content was reduced to fit the configured size limit SHALL indicate that it was truncated, so that a partial result is never presented as a complete one.

#### Scenario: Successful tool execution
- **WHEN** a tool completes successfully and produces output
- **THEN** the result is `{ ok: true, output: "..." }` and is fed back to the LLM as an observation

#### Scenario: Failed tool execution
- **WHEN** a tool fails (non-zero exit, timeout, or resource limit hit)
- **THEN** the result is `{ ok: false, error: "..." }` and the failure reason is fed back to the LLM so it can adjust its next step

#### Scenario: LLM requests an unregistered tool name
- **WHEN** the LLM requests a tool call whose name is not registered in the tool registry
- **THEN** the result for that call is `{ ok: false, error: "..." }` naming the unregistered tool, it is fed back to the LLM as an observation instead of aborting the message handler, and any other tool calls requested in the same batch still execute

#### Scenario: Truncated result is marked as truncated
- **WHEN** a tool produces output larger than the configured limit
- **THEN** the result indicates that its content was truncated, and is not presented as the tool's complete output
