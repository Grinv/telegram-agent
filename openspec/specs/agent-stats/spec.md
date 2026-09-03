## Purpose

Records agent operation statistics (message latency, per-LLM-call token usage by model, tool-call latency and results) into a local SQLite database, so the user can measure which models spend how many tokens, compare before/after performance, and generate reports — all without external dependencies or leaking confidential data to the repository.

## Requirements

### Requirement: Statistics are persisted to a local SQLite database
The system SHALL write agent operation statistics to a local SQLite database file, using Node's built-in `node:sqlite` module (no external dependencies). The database file SHALL reside under a `data/` directory that is excluded from version control, so confidential usage data never enters the repository.

#### Scenario: Database file is created on first write
- **WHEN** the stats recorder receives its first record and the database file does not exist
- **THEN** the file is created (with the schema) at the configured path (default `data/stats.db`) and the record is written

#### Scenario: Database file is gitignored
- **WHEN** the user runs `git status` after stats have been recorded
- **THEN** the `data/` directory and `data/stats.db` file do not appear as untracked or modified files

### Requirement: Per-message statistics are recorded
The system SHALL record one row per processed message, including: timestamp, chat ID, total latency (ms), number of loop iterations, number of tool calls, and success/failure status.

A message SHALL be recorded as successful only once its reply has been delivered to the chat. A reply that the agent produced but could not deliver SHALL be recorded as a failure, with a reason that distinguishes an undeliverable reply from a failure to produce one, so that reported success rate reflects what the user actually received.

#### Scenario: Successful message processing
- **WHEN** a message is processed successfully (LLM returns a final answer, reply is sent)
- **THEN** a row is written to the `messages` table with `ok=1`, the total latency from receipt to reply, the iteration count, and the tool call count

#### Scenario: Failed message processing
- **WHEN** a message fails (inference error, max iterations, unexpected error)
- **THEN** a row is written to the `messages` table with `ok=0`, the latency up to the failure point, and the failure reason

#### Scenario: Reply is produced but cannot be delivered
- **WHEN** the agent produces a final answer but delivering it to the chat fails
- **THEN** the message is recorded with `ok=0` and a failure reason identifying delivery as the cause, and is not recorded as a success

#### Scenario: Success is not recorded before delivery
- **WHEN** the statistics for a message are inspected after the agent has produced an answer but before delivery has been attempted
- **THEN** the message is not yet recorded as successful

### Requirement: Per-LLM-call statistics are recorded with model and tokens
The system SHALL record one row per LLM call, including: the time the call was made, the model used, the identity of the agent that made it, its turn number within the task, the number of input tokens, the number of output tokens, the number of cached tokens, the number of reasoning tokens, the latency, the estimated cost, the role of the call (`main`, `classifier`, or `subagent`), and success/failure.

Input, output, cached and reasoning token counts SHALL be taken from what the provider reports and SHALL NOT be estimated. Where a provider reports no value for a count, the system SHALL record zero so that aggregations remain valid, and SHALL NOT present such a zero as a measured observation in any report — a count the provider never supplied is unknown, not zero.

Each row SHALL be attributable to the task it belongs to, so all calls made while handling one message can be retrieved together.

#### Scenario: LLM call with token usage
- **WHEN** an LLM call completes and the provider reports token usage
- **THEN** a row is recorded with the model name, the reported input and output token counts, the latency, the time of the call, and `role="main"`

#### Scenario: LLM call without token usage
- **WHEN** an LLM call completes and the provider reports no token usage
- **THEN** a row is recorded with zero token counts rather than absent ones, so aggregations still work

#### Scenario: Provider reports no cached or reasoning counts
- **WHEN** the configured provider reports neither a cached-token nor a reasoning-token count
- **THEN** those columns record zero, and a report covering these rows does not state a cache hit rate derived from them

#### Scenario: Every call carries its own time
- **WHEN** several LLM calls are made while handling one message
- **THEN** each row records the time of its own call, and the calls can be ordered within the task by that time

### Requirement: Per-tool-call statistics are recorded
The system SHALL record one row per tool call executed, including: the tool name, the arguments, the measured duration of the execution, success/failure, the size of the result, and the size of the result expressed in tokens.

The recorded duration SHALL be the measured elapsed time of that execution. The system SHALL NOT record a placeholder duration.

Result size SHALL be recorded both in the unit the result is carried in and in tokens, so that tool output can be compared against LLM token counts on the same scale.

#### Scenario: Tool call executed
- **WHEN** a tool call is executed during the loop
- **THEN** a row is recorded with the tool name, its arguments, the measured execution duration, the `ok` flag, and the size of the result in both units

#### Scenario: Duration reflects a slow tool
- **WHEN** two tool calls are executed and one takes materially longer than the other
- **THEN** their recorded durations differ accordingly, and neither is zero

#### Scenario: Several tools in one turn
- **WHEN** one turn executes several tool calls
- **THEN** each gets its own row with its own duration and sizes, attributable to that turn

### Requirement: Each LLM call is attributed to the agent that made it
The system SHALL record, for each LLM call, an identity distinguishing the agent that made it — the main loop, the routing classifier, or a specific sub-agent. When several sub-agents run concurrently while handling one message, each SHALL be distinguishable from the others.

#### Scenario: Concurrent sub-agents are distinguishable
- **WHEN** one message spawns three sub-agents that run at the same time
- **THEN** the calls of each sub-agent carry an identity distinct from the other two, and all three remain attributable to the same task

#### Scenario: Classifier is distinguishable from the main loop
- **WHEN** a message is routed by the classifier and then handled by the main loop
- **THEN** the classifier's call and the main loop's calls carry different agent identities

### Requirement: An estimated cost is recorded for each LLM call
The system SHALL compute an estimated cost for each LLM call from its token counts and a configurable per-model price, and SHALL store that cost on the call's row at the time it is recorded, so that later price changes do not alter the recorded cost of past calls.

A model with no configured price SHALL record a zero cost and SHALL be reportable as unpriced, so that an unpriced model is not silently counted as free.

#### Scenario: Cost is derived from tokens and price
- **WHEN** an LLM call completes for a model that has a configured price
- **THEN** the row records a cost derived from that call's token counts and that price

#### Scenario: Price change does not rewrite history
- **WHEN** the configured price for a model is changed after calls have been recorded
- **THEN** the cost stored on those earlier rows is unchanged

#### Scenario: Unpriced model is identifiable
- **WHEN** an LLM call completes for a model with no configured price
- **THEN** the row records a zero cost and the model can be identified as unpriced rather than as costless

### Requirement: Input tokens are attributed to content categories
The system SHALL record, for each LLM call, how that call's input divides across content categories: the agent's own instructions, the user's request, the conversation that preceded it, and output previously returned by tools. The categories SHALL together account for the call's input, so no part of it is unattributed.

#### Scenario: Categories account for the input
- **WHEN** an LLM call is made with instructions, a user request, prior conversation and prior tool output in its input
- **THEN** each category's share is recorded, and their total accounts for the call's input tokens

#### Scenario: Growth of a category is visible across turns
- **WHEN** a task runs several turns during which tool output accumulates
- **THEN** the recorded tool-output share grows across those turns while the instruction share does not

### Requirement: Repeated input is measured against earlier calls
The system SHALL record, for each LLM call after the first of a task, how much of its input had already been sent to the model in an earlier call of that same task, and how much was new. This measurement SHALL be computed by the system rather than taken from the provider, so it is available regardless of whether the provider reports cache statistics.

#### Scenario: Later turn repeats earlier content
- **WHEN** a task's second turn resends the conversation from its first turn along with new tool output
- **THEN** the repeated portion is recorded as already-sent and only the new tool output is recorded as new

#### Scenario: First call of a task
- **WHEN** the first LLM call of a task is made
- **THEN** none of its input is recorded as repeated

#### Scenario: Repetition is measured per task
- **WHEN** two different messages send similar content
- **THEN** the second message's first call records no repeated input, because repetition is measured within a task and not across tasks

### Requirement: Markdown report generation
The system SHALL provide a command (`npm run stats:report`) that reads the SQLite database and generates a Markdown report file containing: per-model token totals (input, output, total), per-role token breakdown, average latency per model, overall success rate, and tool usage summary. The report file SHALL be written under `data/` (gitignored).

#### Scenario: Report generation with data
- **WHEN** the user runs `npm run stats:report` and the database contains recorded statistics
- **THEN** a Markdown file is generated at `data/stats-report.md` (gitignored) containing tables with per-model token totals, per-role breakdown, latency averages, success rate, and tool usage

#### Scenario: Report generation with empty database
- **WHEN** the user runs `npm run stats:report` and the database is empty or has no recorded statistics
- **THEN** a Markdown file is generated with a "No data" message, and the command exits successfully

### Requirement: Stats recording does not block the orchestrator
The system SHALL write statistics asynchronously (fire-and-forget) so that a slow disk write or database lock does not delay message processing. If a stats write fails, the failure SHALL be logged but SHALL NOT cause the message handling to fail.

#### Scenario: Database write fails
- **WHEN** a stats write fails (e.g. disk full, database locked)
- **THEN** the error is logged as a warning and the message handling continues normally (the reply is still sent)

### Requirement: Schema changes are applied via versioned migrations that preserve existing data
The system SHALL track the stats database's schema version and, whenever the database is opened, SHALL apply any pending migrations in order so the schema matches the version expected by the running code. Applying migrations SHALL preserve all existing rows in `messages`, `llm_calls`, and `tool_calls` — a schema change SHALL NOT require deleting or recreating the database file to pick up the new schema.

#### Scenario: Fresh database is created at the latest schema version
- **WHEN** the stats database file does not exist and the recorder or reporter opens it for the first time
- **THEN** the database is created with all tables at the latest schema version, and its tracked version is set to the latest

#### Scenario: Existing database is upgraded without data loss
- **WHEN** the stats database file exists at an older schema version and a newer version of the code (with additional migrations) opens it
- **THEN** the pending migrations are applied in order, existing rows in `messages`, `llm_calls`, and `tool_calls` remain intact, and the tracked version is updated to the latest

#### Scenario: Database is already at the latest schema version
- **WHEN** the stats database is opened and its tracked version already matches the latest available migration
- **THEN** no migration is applied and the existing data is left untouched
