## Purpose

Containerizes the bot and Ollama as separate Docker containers on a shared Docker network, and provides simple lifecycle commands to start, stop, and inspect the running stack, so deployment is reproducible and operational overhead is minimal.

## Requirements

### Requirement: Bot and Ollama run as separate containers on a shared network
The system SHALL run the bot and Ollama as separate Docker containers attached to the same Docker network, with Ollama reachable from the bot at `http://ollama:11434` via the `OLLAMA_BASE_URL` environment variable.

#### Scenario: Bot reaches Ollama over the shared network
- **WHEN** the bot container starts and makes an inference request
- **THEN** it connects to Ollama at `http://ollama:11434` and the request succeeds without requiring Ollama to be installed on the host

### Requirement: Bot container has Docker socket access for sandbox spawning
The system SHALL mount the host Docker socket into the bot container, so the bot can spawn and manage ephemeral sandbox containers for tool execution. The bot itself is not sandboxed, because it needs network access (Telegram API, Ollama, Docker socket).

#### Scenario: Bot spawns a sandbox container
- **WHEN** the orchestrator needs to execute a tool call
- **THEN** the bot container creates and starts a sandbox container via the Docker socket, and the sandbox runs alongside the bot on the same Docker host

### Requirement: Simple start and stop commands
The system SHALL provide commands that start the entire stack (bot + Ollama) and stop it, with a single invocation, so operators do not need to manage containers individually.

#### Scenario: Starting the stack
- **WHEN** the operator runs the start command (e.g., `npm run docker:up`)
- **THEN** both the bot and Ollama containers start in detached mode, the bot connects to Telegram and begins polling, and the operator sees a confirmation

#### Scenario: Stopping the stack
- **WHEN** the operator runs the stop command (e.g., `npm run docker:down`)
- **THEN** both the bot and Ollama containers are stopped and removed, and no orphaned containers remain

### Requirement: Sandbox image is built on demand or via a dedicated command
The system SHALL provide a command to build the sandbox container image, and the start command SHALL verify the image exists before starting the bot, failing with a clear message if it does not.

#### Scenario: Sandbox image not yet built
- **WHEN** the operator runs the start command and the sandbox image is not present locally
- **THEN** the system reports a clear error telling the operator to build the sandbox image first (e.g., `npm run sandbox:build`)

#### Scenario: Sandbox image already built
- **WHEN** the operator runs the start command and the sandbox image is present
- **THEN** the stack starts without interruption
</content>

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

The isolated deployment SHALL reach the Telegram API only through the component that holds the credential, and SHALL NOT allow the boundary a direct route to the Telegram API.

#### Scenario: Bot authenticates in the isolated deployment
- **WHEN** the bot runs inside the isolation boundary and calls the Telegram API
- **THEN** the call is authenticated, and no environment file inside the boundary contains the token

#### Scenario: The boundary has no direct route to Telegram
- **WHEN** a process inside the boundary requests the Telegram API directly rather than through the credential holder
- **THEN** the request fails, because that host is not allowed for the boundary
