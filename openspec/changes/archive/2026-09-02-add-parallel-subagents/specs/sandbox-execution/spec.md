## MODIFIED Requirements

### Requirement: Tool interface is uniform and extensible
The system SHALL define a tool interface consisting of a name, an arguments object, and a result, so that a new tool that only needs `execInContainer` can be registered and invoked without modifying the orchestrator or the sandbox executor's tool-dispatch logic. Tools SHALL receive a `ToolContext` object (not a raw execution function) as their execution environment, so the context can be extended in later changes without rewriting existing tools. The `ToolContext` SHALL include `execInContainer` (required, for command execution inside the sandbox) and optional `callLlm`, `provider`, `timeoutMs`, `sandboxExecutor`, `toolRegistry`, `runLoop`, `router`, `statsRecorder`, `maxSubIterations`, and `maxSubagents` fields (for tools that need to start nested loops, like `spawn_subagent`). Tools that only use `execInContainer` SHALL continue to work when the optional fields are absent or present.

#### Scenario: A new tool is added without orchestrator changes
- **WHEN** a developer registers a new tool (name, argument schema, handler) in the tool registry
- **THEN** the orchestrator can invoke that tool when the LLM requests it by name, without any code change to the orchestrator or sandbox executor

#### Scenario: Existing tools continue to work when ToolContext is extended
- **WHEN** a later change adds new fields to `ToolContext` (e.g. `callLlm`, `sandboxExecutor`)
- **THEN** tools that only use `ToolContext.execInContainer` continue to work without modification, because they ignore the new fields

#### Scenario: A tool uses the extended context to spawn a nested loop
- **WHEN** the `spawn_subagent` tool is invoked and `ToolContext.runLoop` and `ToolContext.sandboxExecutor` are present
- **THEN** the tool starts a nested `runLoop` with a fresh sandbox, and the parent orchestrator is unaware that a nested loop occurred (it only sees the tool result)

## ADDED Requirements

### Requirement: Sandbox executor supplies the extended tool context
The system SHALL let the sandbox executor be configured, at construction time, with a set of extra `ToolContext` field values, and SHALL merge those values into the `ToolContext` object it builds for every tool call, alongside `execInContainer`. This is the mechanism by which `callLlm`, `runLoop`, `toolRegistry`, and the other optional `ToolContext` fields actually reach a tool at runtime — declaring a field on the `ToolContext` type alone does not populate it.

#### Scenario: A tool needing the extended context receives it
- **WHEN** the sandbox executor is constructed with extra context values (e.g. `callLlm`, `runLoop`, `toolRegistry`) and a tool that reads those fields is subsequently invoked
- **THEN** the `ToolContext` passed to that tool's `execute` includes the configured extra values alongside `execInContainer`

#### Scenario: Ordinary tools are unaffected by configured extra context
- **WHEN** the sandbox executor is constructed with extra context values and a tool that only uses `execInContainer` is invoked
- **THEN** that tool runs exactly as it did before extra context existed; the extra fields are present on the context object but the tool ignores them

#### Scenario: No extra context configured
- **WHEN** the sandbox executor is constructed without any extra context values
- **THEN** every tool call receives a `ToolContext` containing only `execInContainer`, matching pre-existing behavior
