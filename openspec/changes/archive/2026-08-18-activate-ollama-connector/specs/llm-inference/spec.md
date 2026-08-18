## ADDED Requirements

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
