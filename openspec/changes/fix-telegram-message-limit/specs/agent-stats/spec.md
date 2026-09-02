## MODIFIED Requirements

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
