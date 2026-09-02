## Purpose

Enables the LLM to spawn independent sub-agent loops — each with its own sandbox and LLM context — that run concurrently, so multi-part tasks are decomposed and processed in parallel rather than sequentially.

## Requirements

### Requirement: spawn_subagent tool runs a nested loop
The system SHALL provide a `spawn_subagent` tool that takes a task description (and an optional model override) as arguments, starts a fresh think → act → observe loop via `runLoop` with a new sandbox, and returns the sub-agent's final text answer as the tool result. The sub-agent SHALL have access to the same tool registry as the parent (minus the `spawn_subagent`/`spawn_subagents` tools, to prevent infinite recursion).

#### Scenario: LLM spawns a single subagent
- **WHEN** the parent LLM calls `spawn_subagent({ task: "find all CSV files in /work" })`
- **THEN** a new `runLoop` starts with a fresh sandbox, the sub-agent processes the task (potentially using tools like `list_files`), and its final answer is returned as the tool result to the parent LLM

#### Scenario: Sub-agent uses tools independently
- **WHEN** a sub-agent is spawned and the task requires tool use (e.g. reading a file)
- **THEN** the sub-agent's loop calls tools in its own sandbox, and the parent agent's sandbox is not affected by the sub-agent's tool calls

### Requirement: spawn_subagents tool runs multiple loops in parallel
The system SHALL provide a `spawn_subagents` tool that takes an array of task descriptions (and an optional model override) as arguments, starts N `runLoop` calls in parallel via `Promise.all` — each with its own fresh sandbox — and returns all sub-agent results as an array.

#### Scenario: LLM spawns 3 parallel subagents
- **WHEN** the parent LLM calls `spawn_subagents({ tasks: ["analyze file1.csv", "analyze file2.csv", "analyze file3.csv"] })`
- **THEN** three `runLoop` calls start concurrently, each with its own sandbox, and their results are collected and returned to the parent LLM as a single tool result

#### Scenario: One subagent fails, others succeed
- **WHEN** one of the parallel sub-agents fails (e.g. its sandbox hits a resource limit) and the others succeed
- **THEN** the successful sub-agents' results are returned, the failed sub-agent's result is an error message, and the parent LLM receives all results (with the failure noted) so it can decide how to proceed

### Requirement: Sub-agents cannot spawn sub-agents (recursion guard)
The system SHALL exclude `spawn_subagent` and `spawn_subagents` from the tool registry passed to a sub-agent, so sub-agents cannot spawn further sub-agents. This prevents infinite recursion and unbounded resource consumption.

#### Scenario: Sub-agent attempts to spawn a sub-subagent
- **WHEN** a sub-agent's LLM requests a `spawn_subagent` tool call
- **THEN** the tool is not available in the sub-agent's registry (not in the tools list passed to the LLM), so the LLM cannot request it

### Requirement: Concurrent subagent count is limited
The system SHALL enforce a maximum number of concurrent subagents (`MAX_SUBAGENTS`, default 3). When `spawn_subagents` is called with more tasks than the limit, the system SHALL process them in batches of `MAX_SUBAGENTS`.

#### Scenario: Exceeding the concurrent limit
- **WHEN** `MAX_SUBAGENTS=3` and `spawn_subagents` is called with 7 tasks
- **THEN** the first 3 sub-agents run in parallel, the next 3 start after the first batch completes, and the last 1 runs after the second batch — no more than 3 sandboxes exist at any time

### Requirement: Sub-agent LLM calls are recorded in stats with role="subagent"
The system SHALL record each sub-agent's LLM calls in the stats database with `role="subagent"`, so the stats report can distinguish parent-agent tokens from sub-agent tokens. Sub-agent tool calls SHALL be recorded under the parent message's `message_id`.

#### Scenario: Stats show sub-agent token usage separately
- **WHEN** a message triggers 2 parallel sub-agents and the stats report is generated
- **THEN** the `llm_calls` table contains rows with `role="main"` (parent loop), `role="classifier"` (if routing is active), and `role="subagent"` (each sub-agent LLM call), and the report shows per-role token totals
