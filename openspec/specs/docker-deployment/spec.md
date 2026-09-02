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
