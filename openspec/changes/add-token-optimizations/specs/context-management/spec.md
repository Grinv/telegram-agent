## Purpose

Governs what may enter a request to the model and how large each part of it may be — bounding tool results and file reads, compacting long conversations, and keeping the unchanging part of every request identical — so that the agent stops paying repeatedly for content the model has already seen or never needed.

## ADDED Requirements

### Requirement: Tool results are bounded and truncation is disclosed
The system SHALL limit the size of a tool result that enters the conversation to a configured maximum. When a result exceeds it, the system SHALL include a bounded portion and SHALL state within the result that it was truncated and what the full size was, so the model can tell an incomplete result from a complete one and can decide to narrow its request.

Truncation SHALL preserve the beginning of the result, and MAY additionally preserve the end, since both ends of command output routinely carry the meaningful part.

#### Scenario: Oversized result is truncated and says so
- **WHEN** a tool produces a result larger than the configured maximum
- **THEN** the conversation receives a bounded portion of it together with an indication that it was truncated and how large the full result was

#### Scenario: Result within the limit is untouched
- **WHEN** a tool produces a result within the configured maximum
- **THEN** the conversation receives it unchanged, with no truncation indication

#### Scenario: Model can narrow after a truncation
- **WHEN** the model receives a truncated result and issues a narrower request
- **THEN** the narrower request is executed normally and its result is subject to the same limit

### Requirement: File reads can be bounded to a range
The system SHALL allow a request to read a file to specify a range of lines, and SHALL return only that range. A request that specifies no range SHALL continue to return the file, subject to the tool-result limit.

When a file is returned in part, the system SHALL state which part, so the model can request a different range rather than assuming it has the whole file.

#### Scenario: Reading a specified range
- **WHEN** a file read specifies a range of lines
- **THEN** only those lines are returned, and the response states which lines they are

#### Scenario: Reading without a range
- **WHEN** a file read specifies no range
- **THEN** the file's contents are returned as before, still subject to the tool-result limit

#### Scenario: Range beyond the end of the file
- **WHEN** a file read specifies a range that starts beyond the file's last line
- **THEN** the result reports that the range is empty and states the file's length, rather than failing

### Requirement: Long conversations are compacted before being sent
The system SHALL, when a conversation exceeds a configured size, send a compacted form of it rather than the whole thing: the most recent turns SHALL be sent intact, and earlier turns SHALL be replaced by a summary that preserves the facts later turns depend on.

Compaction SHALL affect only what is sent to the model. The stored conversation SHALL remain complete, so compaction is never a silent loss of the user's history.

#### Scenario: Short conversation is sent whole
- **WHEN** a conversation is within the configured size and a message is handled
- **THEN** the whole conversation is sent to the model, uncompacted

#### Scenario: Long conversation is compacted
- **WHEN** a conversation exceeds the configured size and a message is handled
- **THEN** the request carries the most recent turns intact and a summary in place of the earlier ones, and is smaller than the uncompacted conversation would have been

#### Scenario: Stored history is not affected by compaction
- **WHEN** a conversation has been compacted for sending
- **THEN** the stored conversation still contains every turn, and clearing it remains the only thing that removes turns

#### Scenario: A fact from a compacted turn is still available
- **WHEN** a conversation is compacted and a later user message refers to something stated in a turn that was summarized
- **THEN** the agent can still answer from the summary

### Requirement: The unchanging part of a request is byte-identical across calls
The system SHALL assemble the leading, unchanging part of every request — the agent's instructions and the skill index — identically on every call, so that a provider able to reuse a repeated prefix is not prevented from doing so by incidental variation. This part SHALL NOT contain values that change between calls, such as timestamps, identifiers, or content in a varying order.

#### Scenario: Prefix is identical between two calls
- **WHEN** two requests are assembled under the same configuration, in the same process or in different ones
- **THEN** their leading unchanging part is byte-identical

#### Scenario: Prefix comes first
- **WHEN** a request is assembled
- **THEN** the unchanging part precedes the conversation and the user's turn, so the identical portion is a prefix rather than a fragment in the middle

#### Scenario: Configuration change alters the prefix
- **WHEN** a skill is added and requests are assembled afterwards
- **THEN** the prefix reflects the new skill index, and remains identical across calls made after the change
