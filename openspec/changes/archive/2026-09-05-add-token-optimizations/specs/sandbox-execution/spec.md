## MODIFIED Requirements

### Requirement: Tool execution results are structured
The system SHALL return the outcome of each tool call as a structured result containing at minimum a success/failure flag, stdout or output content, and an error message when the tool failed, so the orchestrator can feed the result back to the LLM in a consistent format. This applies even when the requested tool name is not registered: the system SHALL NOT let that failure propagate as an unhandled error out of the sandbox executor, and other tool calls in the same batch SHALL still be attempted.

A result whose content was reduced SHALL indicate how it was reduced, so that a partial result is never presented as a complete one: a result cut to fit the configured size limit SHALL indicate that it was truncated, and a result rewritten into a shorter form SHALL indicate that it was compressed. A result reduced in both ways SHALL indicate both.

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

#### Scenario: Compressed result is marked as compressed
- **WHEN** a shell command's output is rewritten into a shorter form before it reaches the orchestrator
- **THEN** the result indicates that its content was compressed, and is not presented as the command's verbatim output

### Requirement: Sandbox image is pre-built and minimal
The system SHALL use a single pre-built sandbox container image that is minimal (Alpine-based) and contains only the shell, core utilities, an HTTP command-line client, and a shell-output compression binary (RTK) needed by the available tools, so sandbox startup is fast and the attack surface stays deliberately small and enumerable rather than open-ended.

The image SHALL be built for the `amd64` architecture; a build for any other architecture SHALL fail with a message explaining why, rather than silently producing an image whose compression binary does not run.

#### Scenario: Sandbox starts from a pre-built image
- **WHEN** a sandbox container is spawned
- **THEN** it uses the pre-built image referenced by the `SANDBOX_IMAGE` configuration variable, and no image build happens at runtime

#### Scenario: HTTP client is available for networked skills
- **WHEN** a tool runs a command that invokes the HTTP command-line client inside the sandbox
- **THEN** the client is present in the image and executes, regardless of the configured network mode — in isolated mode it runs but cannot connect

#### Scenario: Building the sandbox image for an unsupported architecture fails clearly
- **WHEN** the sandbox image is built for an architecture other than `amd64`
- **THEN** the build fails with a message identifying the unsupported architecture, rather than producing an image whose compression binary fails to load at runtime
