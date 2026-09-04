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
The system SHALL record, for each LLM call, how that call's input divides across content categories: the agent's own instructions, the definitions of the tools advertised to the model, the user's request, the conversation that preceded it, and output previously returned by tools. The categories SHALL together account for the call's whole input, including content the model receives outside the message list, so no part of it is unattributed.

The definitions of the advertised tools SHALL be attributed to their own category rather than merged into the agent's instructions, so that content generated from the registered tools is distinguishable from instruction text that is authored and edited directly.

#### Scenario: Categories account for the input
- **WHEN** an LLM call is made with instructions, tool definitions, a user request, prior conversation and prior tool output in its input
- **THEN** each category's share is recorded, and their total accounts for the call's input tokens

#### Scenario: Tool definitions are attributed to themselves
- **WHEN** an LLM call advertises tools to the model
- **THEN** the tokens those definitions occupy are recorded under the tool-definition category, and are not added to the instruction, user-request, conversation or tool-output categories

#### Scenario: Growth of a category is visible across turns
- **WHEN** a task runs several turns during which tool output accumulates
- **THEN** the recorded tool-output share grows across those turns while the instruction share does not

#### Scenario: An unchanged category does not appear to change
- **WHEN** two turns of the same task are made with byte-identical instructions and byte-identical tool definitions, and the later turn carries additional tool output
- **THEN** the recorded instruction and tool-definition figures are the same for both turns, and only the categories whose content actually changed differ

#### Scenario: A call that advertises no tools
- **WHEN** an LLM call is made with no tools advertised
- **THEN** no input is attributed to the tool-definition category, and the remaining categories account for the call's whole input

### Requirement: Repeated input is measured against earlier calls
The system SHALL record, for each LLM call after the first of a task, how much of its input had already been sent to the model in an earlier call of that same task, and how much was new. This measurement SHALL account for every part of the input the model receives, including the tool definitions, not only the message list. It SHALL be computed by the system rather than taken from the provider, so it is available regardless of whether the provider reports cache statistics.

Repetition SHALL continue to be measured within a task and not across tasks. Content that is identical on every call therefore counts as new on a task's first call and as repeated on each call after it.

#### Scenario: Later turn repeats earlier content
- **WHEN** a task's second turn resends the conversation from its first turn along with new tool output
- **THEN** the repeated portion is recorded as already-sent and only the new tool output is recorded as new

#### Scenario: Unchanged tool definitions count as repeated on a later turn
- **WHEN** a task's second turn advertises the same tool definitions as its first
- **THEN** the tokens those definitions occupy are recorded as repeated rather than as new, and are not omitted from the measurement

#### Scenario: First call of a task
- **WHEN** the first LLM call of a task is made
- **THEN** none of its input is recorded as repeated

#### Scenario: Repetition is measured per task
- **WHEN** two different messages send similar content
- **THEN** the second message's first call records no repeated input, because repetition is measured within a task and not across tasks

### Requirement: Recorded activity is exported as distributed traces
The system SHALL, in addition to recording statistics locally, emit the same activity as a distributed trace: one span covering the handling of a message, a child span for each LLM call made while handling it, and a child span for each tool call. Each span SHALL carry the measurements already recorded for that unit of work — for an LLM call, the model, input and output token counts, latency, estimated cost, turn number and the identity of the agent that made it; for a tool call, the tool name, input size, output size, output token count and duration; for a message, its total latency, iteration count, tool-call count and success or failure.

The parent-child relationship SHALL reflect the actual work: a sub-agent's LLM calls SHALL appear beneath the tool call that spawned them, so a reader can see what a single message cost in total and where that cost was incurred.

#### Scenario: A message that used tools produces a nested trace
- **WHEN** a message is handled that makes two LLM calls with a tool call between them, and export is configured
- **THEN** the exported trace contains one span for the message, two LLM-call spans and one tool-call span beneath it, each carrying that unit's recorded measurements

#### Scenario: Sub-agent work is attributed to the tool call that started it
- **WHEN** a message is handled in which a tool call spawns sub-agents that make their own LLM calls, and export is configured
- **THEN** the sub-agents' LLM-call spans appear beneath that tool call's span, not as siblings of the message's own LLM calls

#### Scenario: A failed message is exported as failed
- **WHEN** handling a message fails and export is configured
- **THEN** the message's span records the failure and its reason, rather than being omitted or exported as successful

### Requirement: Export is off unless an operator configures a destination
The system SHALL export traces only to a destination the operator has configured. When no destination is configured, the system SHALL NOT export, SHALL NOT require any collector or backend to be running, and SHALL behave exactly as it does with the feature absent.

No destination SHALL be configured by default, so that no deployment sends its activity anywhere without the operator choosing to.

#### Scenario: No destination configured
- **WHEN** the agent runs with no export destination configured
- **THEN** it handles messages normally, records statistics locally as before, exports nothing, and does not require a collector to be reachable

#### Scenario: Operator configures a destination
- **WHEN** the operator configures an export destination and the agent handles a message
- **THEN** the message's trace is sent to that destination

#### Scenario: Default configuration exports nothing
- **WHEN** the agent is deployed using the shipped default configuration
- **THEN** no export destination is set, and no activity leaves the machine

### Requirement: Derived context measurements travel with the exported spans
The system SHALL carry on each exported LLM-call span the derived measurements it computes for that call: the division of the call's input tokens across every content category it records, and the proportion of the call's input that had already been sent to the model versus what was new. Every category the system records SHALL be carried, so a category added to the recorded division is not silently absent from the exported one.

#### Scenario: Category and repetition figures reach the destination
- **WHEN** an LLM call whose input was attributed across content categories and measured for repetition is exported
- **THEN** its span carries both the per-category input token counts and the repeated and new input token counts

#### Scenario: A call whose derived figures could not be computed
- **WHEN** an LLM call is exported for which a derived measurement was not computed
- **THEN** the span omits that measurement rather than carrying a zero in its place

### Requirement: A figure the provider never reported is not exported as a measurement
The system SHALL NOT export a value that was never measured as though it had been. In particular, when a provider reports no cached-token or reasoning-token count, the corresponding span attribute SHALL be omitted rather than set to zero.

#### Scenario: Provider reports no cached-token count
- **WHEN** an LLM call is exported whose provider reported no cached-token count
- **THEN** the span omits the cached-token attribute rather than recording it as zero

### Requirement: Markdown report generation
The system SHALL provide a command (`npm run stats:report`) that reads the SQLite database and generates a Markdown report file containing: per-model token totals (input, output, total), per-role token breakdown, average latency per model, overall success rate, and tool usage summary. The report file SHALL be written under `data/` (gitignored).

#### Scenario: Report generation with data
- **WHEN** the user runs `npm run stats:report` and the database contains recorded statistics
- **THEN** a Markdown file is generated at `data/stats-report.md` (gitignored) containing tables with per-model token totals, per-role breakdown, latency averages, success rate, and tool usage

#### Scenario: Report generation with empty database
- **WHEN** the user runs `npm run stats:report` and the database is empty or has no recorded statistics
- **THEN** a Markdown file is generated with a "No data" message, and the command exits successfully

### Requirement: A summary view reports activity, spend and per-task averages
The system SHALL provide a summary view over all recorded activity, reporting: the number of tasks completed, total input, output and cached tokens, the total estimated cost, the average tokens, turns and tool calls per task, and the share of total tokens attributable to each tool, ranked.

#### Scenario: Summary over recorded activity
- **WHEN** the summary view is generated over a database holding several completed tasks
- **THEN** it reports the task count, the token totals, the estimated cost, the per-task averages, and the tools ranked by their share of total tokens

#### Scenario: Summary over an empty database
- **WHEN** the summary view is generated over a database with no recorded activity
- **THEN** it reports that there is no data and completes successfully rather than failing or printing zeroes as though they were measurements

### Requirement: A timeline view walks one task turn by turn
The system SHALL provide a view of a single identified task that lists its turns in order and, for each turn, the tokens the LLM call consumed and the tool calls it produced with their result sizes, so that the cost of one run can be read without querying the tables by hand.

#### Scenario: Timeline of a multi-turn task
- **WHEN** the timeline view is generated for a task that ran several turns with tool calls
- **THEN** it shows each turn in order with that turn's LLM token count, and under it the tool calls made in that turn with their result sizes

#### Scenario: Timeline of an unknown task
- **WHEN** the timeline view is requested for a task identifier that is not in the database
- **THEN** it reports that the task was not found and completes successfully rather than failing

### Requirement: An analysis view identifies where tokens are going
The system SHALL provide an analysis view reporting: the tools ranked by their share of generated tokens, the single most expensive turn with its input token count, the division of input tokens across content categories, and the proportion of input that had already been sent to the model versus what was new.

The category division SHALL name every category it reports, including the tool definitions, so a reader can see what share of a request is content resent unchanged on every call rather than inferring it.

#### Scenario: Analysis identifies the largest consumers
- **WHEN** the analysis view is generated over a database holding tasks that used several tools across multiple turns
- **THEN** it ranks the tools by token share, names the most expensive turn and its input token count, breaks input down by content category, and reports the repeated and new proportions of input

#### Scenario: Categories account for the reported input
- **WHEN** the analysis view reports the division of input across content categories
- **THEN** the reported shares account for the input tokens they describe, leaving no unattributed remainder

#### Scenario: The constant portion of a request is visible
- **WHEN** the analysis view reports the category division over calls that advertised tools
- **THEN** the tool-definition category appears as its own line with its own share, distinct from the agent's instructions

### Requirement: Unavailable figures are reported as unavailable
The system SHALL distinguish a figure that was never measured from a figure measured as zero, and SHALL NOT present the former as an observation. In particular, a cache hit rate SHALL be reported only over calls whose provider actually reported cached tokens, and SHALL be omitted or marked unavailable otherwise.

A figure recorded under a superseded method of attribution SHALL be distinguishable from one recorded under the current method, and SHALL NOT be aggregated together with it as though the two were the same measurement.

#### Scenario: Provider reported no cache statistics
- **WHEN** a view covering calls whose provider reported no cached tokens would otherwise show a cache hit rate
- **THEN** the rate is reported as unavailable rather than as zero percent

#### Scenario: Unpriced models in a cost total
- **WHEN** a view reports total estimated cost over activity that included models with no configured price
- **THEN** it indicates that part of the activity was unpriced, so the total is not read as complete spend

#### Scenario: Data recorded before a field existed
- **WHEN** a view covers rows recorded before a field was introduced, whose stored value is a migration default rather than a measurement
- **THEN** those rows are excluded from that field's aggregate or the aggregate is marked as partial, rather than averaging defaults in as observations

#### Scenario: Rows recorded under the previous attribution
- **WHEN** a view reports content-category or repeated-input figures over rows recorded before tool definitions were attributed
- **THEN** those rows are excluded from the aggregate or the aggregate is marked as partial, rather than combining the two attributions into one figure

### Requirement: Stats recording does not block the orchestrator
The system SHALL write statistics asynchronously (fire-and-forget) so that a slow disk write or database lock does not delay message processing. If a stats write fails, the failure SHALL be logged but SHALL NOT cause the message handling to fail.

Exporting SHALL be subject to the same rule. An export destination that is unreachable, slow to respond, or rejects what it is sent SHALL NOT delay a reply, SHALL NOT fail the message being handled, and SHALL NOT cause local statistics to go unrecorded. Such a failure SHALL be logged, and SHALL NOT be logged once per span in a way that floods the log while the destination stays down.

#### Scenario: Database write fails
- **WHEN** a stats write fails (e.g. disk full, database locked)
- **THEN** the error is logged as a warning and the message handling continues normally (the reply is still sent)

#### Scenario: Export destination is unreachable
- **WHEN** an export destination is configured but cannot be reached while a message is being handled
- **THEN** the reply is still sent, the message's statistics are still recorded locally, and the export failure is logged

#### Scenario: Export destination is slow
- **WHEN** an export destination is configured but responds more slowly than the time it takes to handle a message
- **THEN** the reply is not delayed waiting for it

#### Scenario: Export destination stays down
- **WHEN** an export destination remains unreachable across many handled messages
- **THEN** the failure is reported without emitting one log entry per unexported span

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
