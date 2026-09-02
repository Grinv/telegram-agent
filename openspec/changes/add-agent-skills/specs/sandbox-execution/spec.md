## MODIFIED Requirements

### Requirement: Tool interface is uniform and extensible
The system SHALL define a tool interface consisting of a name, an arguments object, and a result, so that a new tool can be registered and invoked without modifying the orchestrator or the sandbox executor's tool-dispatch logic.

Tools SHALL receive a context object (not a raw execution function) as their execution environment, so the environment can be extended without rewriting existing tools. That context SHALL always provide the ability to run a command inside the sandbox, and MAY additionally carry capabilities that only some tools need — for example the ability to start a nested agent loop, or access to content the agent process loaded at startup. A tool that uses only command execution SHALL continue to work whether or not the additional capabilities are present.

A tool SHALL be free to answer from the additional capabilities without running anything in the sandbox, so that content which exists only in the agent process — and is therefore not present on any sandbox filesystem — can still be served through the tool interface.

#### Scenario: A new tool is added without orchestrator changes
- **WHEN** a developer registers a new tool (name, argument schema, handler) in the tool registry
- **THEN** the orchestrator can invoke that tool when the LLM requests it by name, without any code change to the orchestrator or sandbox executor

#### Scenario: Existing tools continue to work when ToolContext is extended
- **WHEN** a later change adds new capabilities to the tool execution context
- **THEN** tools that only run commands in the sandbox continue to work without modification, because they ignore the added capabilities

#### Scenario: A tool uses the extended context to spawn a nested loop
- **WHEN** a tool that starts nested agent loops is invoked and the context carries the capabilities it needs
- **THEN** the tool starts a nested loop with a fresh sandbox, and the parent orchestrator is unaware that a nested loop occurred — it only sees the tool result

#### Scenario: A tool answers from the agent process without touching the sandbox
- **WHEN** a tool that serves content loaded by the agent process at startup is invoked
- **THEN** it returns that content as its result without running any command in the sandbox, and succeeds even though the content exists nowhere on the sandbox's filesystem
