## MODIFIED Requirements

### Requirement: Tool interface is uniform and extensible
The system SHALL define a tool interface consisting of a name, an arguments object, and a result, so that new tools can be registered and invoked without modifying the orchestrator or the sandbox executor. Tools SHALL receive a `ToolContext` object (not a raw execution function) as their execution environment, so the context can be extended in later changes without rewriting existing tools. The `ToolContext` SHALL include `execInContainer` (required, for command execution inside the sandbox) and optional `callLlm`, `sandboxExecutor`, `toolRegistry`, `runLoop`, and `router` fields (for tools that need to start nested loops, like `spawn_subagent`). Tools that only use `execInContainer` SHALL continue to work when the optional fields are absent or present.

#### Scenario: A new tool is added without orchestrator changes
- **WHEN** a developer registers a new tool (name, argument schema, handler) in the tool registry
- **THEN** the orchestrator can invoke that tool when the LLM requests it by name, without any code change to the orchestrator or sandbox executor

#### Scenario: Existing tools continue to work when ToolContext is extended
- **WHEN** a later change adds new fields to `ToolContext` (e.g. `callLlm`, `sandboxExecutor`)
- **THEN** tools that only use `ToolContext.execInContainer` continue to work without modification, because they ignore the new fields

#### Scenario: A tool uses the extended context to spawn a nested loop
- **WHEN** the `spawn_subagent` tool is invoked and `ToolContext.runLoop` and `ToolContext.sandboxExecutor` are present
- **THEN** the tool starts a nested `runLoop` with a fresh sandbox, and the parent orchestrator is unaware that a nested loop occurred (it only sees the tool result)
