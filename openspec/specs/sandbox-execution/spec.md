## Purpose

Executes tool calls requested by the LLM inside ephemeral Docker sandbox containers with strict isolation, so an LLM-requested command or file operation can never reach the host filesystem, host network, or other running processes.

## Requirements

### Requirement: Tool interface is uniform and extensible
The system SHALL define a tool interface consisting of a name, an arguments object, and a result, so that new tools can be registered and invoked without modifying the orchestrator or the sandbox executor. Tools SHALL receive a `ToolContext` object (not a raw execution function) as their execution environment, so the context can be extended in later changes without rewriting existing tools.

#### Scenario: A new tool is added without orchestrator changes
- **WHEN** a developer registers a new tool (name, argument schema, handler) in the tool registry
- **THEN** the orchestrator can invoke that tool when the LLM requests it by name, without any code change to the orchestrator or sandbox executor

#### Scenario: Existing tools continue to work when ToolContext is extended
- **WHEN** a later change adds new fields to `ToolContext` (e.g. `callLlm`, `sandboxExecutor`)
- **THEN** tools that only use `ToolContext.execInContainer` continue to work without modification, because they ignore the new fields

### Requirement: Each tool-use request runs in a fresh sandbox
The system SHALL spawn a new sandbox container for each tool-use request (each act step in the think → act → observe loop) and SHALL tear it down — container removed, filesystem gone — immediately after the tools in that step complete, so no state leaks between requests.

#### Scenario: Two consecutive tool-use requests do not share state
- **WHEN** the LLM requests a tool call in iteration 1 and another tool call in iteration 2 of the same message's loop
- **THEN** each tool call runs in a separate sandbox container, and a file written by the first is not visible to the second

### Requirement: Sandbox filesystem is read-only except the workdir
The system SHALL mount the sandbox container's root filesystem as read-only, with a single writable working directory as the only location where tools can create, modify, or delete files.

#### Scenario: Tool attempts to write outside the workdir
- **WHEN** a tool tries to write to a path outside the designated working directory (e.g., `/etc/foo`)
- **THEN** the write fails with a read-only filesystem error and no host or system files are modified

### Requirement: Sandbox has no host network access
The system SHALL run the sandbox container with host network disabled, so tools executed inside it cannot reach the host machine's network, the Docker API, the Ollama container, or the Telegram API.

#### Scenario: Tool attempts a network request
- **WHEN** a tool inside the sandbox attempts to open a network connection to any host
- **THEN** the connection is refused or fails, and no external service is reachable

### Requirement: Sandbox resource limits are enforced
The system SHALL constrain each sandbox container with a CPU limit, a memory limit, and a maximum execution timeout, so a runaway tool cannot consume unbounded host resources or hang indefinitely.

#### Scenario: Tool exceeds the memory limit
- **WHEN** a tool inside the sandbox allocates memory beyond the configured limit
- **THEN** the sandbox container is killed by the runtime and the tool call is reported as a failure

#### Scenario: Tool exceeds the execution timeout
- **WHEN** a tool call does not complete within the configured sandbox timeout
- **THEN** the system kills the sandbox container and reports a timeout failure for that tool call

### Requirement: Tool execution results are structured
The system SHALL return the outcome of each tool call as a structured result containing at minimum a success/failure flag, stdout or output content, and an error message when the tool failed, so the orchestrator can feed the result back to the LLM in a consistent format. This applies even when the requested tool name is not registered: the system SHALL NOT let that failure propagate as an unhandled error out of the sandbox executor, and other tool calls in the same batch SHALL still be attempted.

#### Scenario: Successful tool execution
- **WHEN** a tool completes successfully and produces output
- **THEN** the result is `{ ok: true, output: "..." }` and is fed back to the LLM as an observation

#### Scenario: Failed tool execution
- **WHEN** a tool fails (non-zero exit, timeout, or resource limit hit)
- **THEN** the result is `{ ok: false, error: "..." }` and the failure reason is fed back to the LLM so it can adjust its next step

#### Scenario: LLM requests an unregistered tool name
- **WHEN** the LLM requests a tool call whose name is not registered in the tool registry
- **THEN** the result for that call is `{ ok: false, error: "..." }` naming the unregistered tool, it is fed back to the LLM as an observation instead of aborting the message handler, and any other tool calls requested in the same batch still execute

### Requirement: Sandbox image is pre-built and minimal
The system SHALL use a single pre-built sandbox container image that is minimal (Alpine-based) and contains only the shell and core utilities needed by the available tools, so sandbox startup is fast and the attack surface is small.

#### Scenario: Sandbox starts from a pre-built image
- **WHEN** a sandbox container is spawned
- **THEN** it uses the pre-built image referenced by the `SANDBOX_IMAGE` configuration variable, and no image build happens at runtime
</content>
