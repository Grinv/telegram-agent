## MODIFIED Requirements

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
