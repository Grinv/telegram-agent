## Purpose

Defines a standardized, pluggable contract for invoking LLM inference providers, so new providers can be added without changing the code that calls them, and executes each call in isolation so failures don't affect the bot process.

## Requirements

### Requirement: Standardized connector interface
The system SHALL expose every LLM inference provider through the same interface, accepting a prompt and returning a response, so callers do not need to know which provider is active.

#### Scenario: Swapping providers requires no caller changes
- **WHEN** the active connector is changed from one provider to another
- **THEN** the code that requests an LLM response continues to work unmodified

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
The system SHALL enforce a maximum wait time for each inference call and SHALL terminate the inference process if it exceeds that time.

#### Scenario: Inference hangs
- **WHEN** an inference call does not complete within the configured timeout
- **THEN** the system terminates the inference process and reports a timeout failure for that request instead of waiting indefinitely

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
