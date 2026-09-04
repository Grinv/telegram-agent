## ADDED Requirements

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

## MODIFIED Requirements

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
