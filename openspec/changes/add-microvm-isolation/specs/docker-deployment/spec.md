## ADDED Requirements

### Requirement: The stack can run inside the isolation boundary
The system SHALL support running the bot on the container runtime inside the agent's isolation boundary, in addition to the existing deployment directly on a host's container runtime. Both deployments SHALL be supported; adopting the isolated one SHALL NOT be required.

When running inside the boundary, the bot's access to a container runtime SHALL be to the boundary's own runtime, not the host's, so sandbox containers it spawns never appear on the host.

#### Scenario: Tool sandboxes use the boundary's runtime
- **WHEN** the bot spawns a sandbox container while running inside the boundary
- **THEN** the container is created by the boundary's container runtime, and no container appears on the host's runtime

#### Scenario: Host deployment still works
- **WHEN** the stack is started on a host's container runtime without any isolation boundary
- **THEN** it behaves as it did before this capability existed

### Requirement: The LLM provider is reached without being exposed
The system SHALL allow the isolated bot to reach an LLM provider running on the host while that provider remains bound to the host's loopback interface only, so the provider is not reachable from the local network.

Access SHALL require an explicit grant naming the provider's port. Without that grant the provider SHALL be unreachable from inside the boundary.

#### Scenario: Provider is reachable from the isolated bot
- **WHEN** the provider listens on the host's loopback interface, its port has been granted to the boundary, and the bot sends an inference request
- **THEN** the request reaches the provider and the response is returned

#### Scenario: Provider is not reachable from the local network
- **WHEN** another machine on the local network requests the provider's port on this host
- **THEN** the request fails

#### Scenario: Provider is unreachable without the grant
- **WHEN** the provider's port has not been granted to the boundary and the bot sends an inference request
- **THEN** the request fails and does not reach the provider

### Requirement: The bot's credentials are supplied without a file on disk
The system SHALL support supplying the bot's Telegram credential to the isolated deployment without writing it into an environment file that the agent can read.

#### Scenario: Bot authenticates in the isolated deployment
- **WHEN** the bot runs inside the isolation boundary and calls the Telegram API
- **THEN** the call is authenticated, and no environment file inside the boundary contains the token
