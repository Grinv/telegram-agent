## MODIFIED Requirements

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

## ADDED Requirements

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
