## ADDED Requirements

### Requirement: The stack can run inside the isolation boundary
The system SHALL support running the bot and its LLM provider on the container runtime inside the agent's isolation boundary, in addition to the existing deployment directly on a host's container runtime. Both deployments SHALL be supported; adopting the isolated one SHALL NOT be required.

When running inside the boundary, the bot SHALL reach the LLM provider without any traffic leaving the boundary, and the bot's access to a container runtime SHALL be to the boundary's own runtime, not the host's.

#### Scenario: Bot reaches the LLM provider inside the boundary
- **WHEN** the stack is started inside the isolation boundary and the bot sends an inference request
- **THEN** the request reaches the LLM provider over the boundary's internal network, and no outbound network grant is required for it

#### Scenario: Tool sandboxes use the boundary's runtime
- **WHEN** the bot spawns a sandbox container while running inside the boundary
- **THEN** the container is created by the boundary's container runtime, and no container appears on the host's runtime

#### Scenario: Host deployment still works
- **WHEN** the stack is started on a host's container runtime without any isolation boundary
- **THEN** it behaves as it did before this capability existed

### Requirement: The bot's credentials are supplied without a file on disk
The system SHALL support supplying the bot's Telegram credential to the isolated deployment without writing it into an environment file that the agent can read.

#### Scenario: Bot authenticates in the isolated deployment
- **WHEN** the bot runs inside the isolation boundary and calls the Telegram API
- **THEN** the call is authenticated, and no environment file inside the boundary contains the token
