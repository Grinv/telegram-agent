## MODIFIED Requirements

### Requirement: Inference calls are bounded by a timeout
The system SHALL enforce a maximum wait time for each inference call and SHALL terminate the inference process if it exceeds that time. The configured timeout SHALL be the actual effective limit on how long a call may run — no shorter, undocumented limit internal to the connector's transport SHALL cause the call to fail before the configured timeout is reached.

#### Scenario: Inference hangs
- **WHEN** an inference call does not complete within the configured timeout
- **THEN** the system terminates the inference process and reports a timeout failure for that request instead of waiting indefinitely

#### Scenario: A slow but legitimate call outlasts a transport-internal default
- **WHEN** an inference call takes longer than a default timeout built into the connector's underlying HTTP transport, but less than the configured timeout
- **THEN** the call completes successfully and is not reported as a failure
