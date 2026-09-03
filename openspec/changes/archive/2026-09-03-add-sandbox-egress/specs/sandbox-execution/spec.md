## REMOVED Requirements

### Requirement: Sandbox has no host network access
**Reason**: Total network isolation made an entire class of skill impossible — anything that calls an HTTP API from the command line. The guarantee is replaced by a configurable one whose default is identical to this requirement, so the isolated posture remains available and remains the default.

**Migration**: Deployments that set no sandbox network mode keep exactly the behaviour this requirement described and need no action. Deployments that want networked skills opt in to egress mode, which is covered by the "Sandbox network access is isolated by default and egress is opt-in" requirement below, including what stays unreachable in that mode.

## ADDED Requirements

### Requirement: Sandbox network access is isolated by default and egress is opt-in
The system SHALL support two sandbox network modes, selected by configuration, and SHALL default to full isolation.

In **isolated** mode (the default), the system SHALL run the sandbox container with no network access at all, so tools executed inside it cannot reach any host, service, or network.

In **egress** mode, the system SHALL attach the sandbox container to a network dedicated to sandboxes, so that outbound requests to the public internet succeed. In this mode the system SHALL keep the agent's own services unreachable from the sandbox: no container of the agent's deployment — in particular the LLM provider container and the bot container — SHALL be attached to the sandbox network, and the Docker API SHALL NOT be exposed inside the sandbox.

The configured mode SHALL be observable at startup, so an operator can tell which posture a running deployment has.

#### Scenario: Default configuration is fully isolated
- **WHEN** no sandbox network mode is configured and a tool inside the sandbox attempts to open a network connection to any host
- **THEN** the connection fails and no external service is reachable

#### Scenario: Isolated mode is explicitly configured
- **WHEN** the sandbox network mode is configured to isolated and a tool attempts any network request
- **THEN** the connection fails, exactly as with no configuration at all

#### Scenario: Egress mode reaches a public endpoint
- **WHEN** the sandbox network mode is configured to egress and a tool inside the sandbox requests a public HTTP endpoint
- **THEN** the request succeeds and the response is returned to the tool

#### Scenario: Egress mode cannot reach the agent's own services
- **WHEN** the sandbox network mode is configured to egress and a tool inside the sandbox attempts to reach the LLM provider container or the bot container by its service name or container address
- **THEN** the connection fails, because those containers are not on the sandbox network

#### Scenario: Egress mode does not expose the Docker API
- **WHEN** the sandbox network mode is configured to egress and a tool inside the sandbox attempts to reach the Docker API
- **THEN** the attempt fails, because the Docker socket is not mounted into the sandbox in either mode

#### Scenario: Configured mode is visible at startup
- **WHEN** the system starts
- **THEN** the active sandbox network mode is reported in the startup logs

### Requirement: The sandbox egress network is provisioned before use
The system SHALL ensure the dedicated sandbox network exists before spawning a sandbox in egress mode, creating it if absent, so that enabling egress mode does not require a manual provisioning step. Provisioning SHALL be idempotent: an already-existing network SHALL be reused rather than recreated or duplicated.

#### Scenario: Network is missing on first use
- **WHEN** egress mode is configured and the sandbox network does not exist yet, and a tool call is executed
- **THEN** the network is created and the sandbox container is attached to it, and the tool call proceeds

#### Scenario: Network already exists
- **WHEN** egress mode is configured and the sandbox network already exists, and a tool call is executed
- **THEN** the existing network is reused, no duplicate network is created, and the tool call proceeds

#### Scenario: Isolated mode provisions nothing
- **WHEN** isolated mode is configured and a tool call is executed
- **THEN** no sandbox network is created

## MODIFIED Requirements

### Requirement: Sandbox image is pre-built and minimal
The system SHALL use a single pre-built sandbox container image that is minimal (Alpine-based) and contains only the shell, core utilities, and an HTTP command-line client needed by the available tools, so sandbox startup is fast and the attack surface is small.

#### Scenario: Sandbox starts from a pre-built image
- **WHEN** a sandbox container is spawned
- **THEN** it uses the pre-built image referenced by the `SANDBOX_IMAGE` configuration variable, and no image build happens at runtime

#### Scenario: HTTP client is available for networked skills
- **WHEN** a tool runs a command that invokes the HTTP command-line client inside the sandbox
- **THEN** the client is present in the image and executes, regardless of the configured network mode — in isolated mode it runs but cannot connect

