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

### Requirement: Shell command output is compressed before it enters the conversation
The system SHALL compress the output of a shell command before that output enters the conversation, reducing it to what the output means — noise filtered out, repeated lines collapsed, long listings summarised — rather than carrying every line verbatim.

A compressed result SHALL state that it was compressed, so the model can tell a summary from the command's literal output and can ask for the literal output when it needs it. A summary the model mistakes for verbatim text is worse than no summary, because it will reason confidently over something the command never said.

Compression SHALL apply to shell command output only. The result of a tool that does not run a shell command SHALL be passed through unchanged by this requirement, and remains subject to the tool-result limit.

Compression and the tool-result limit SHALL compose in that order: output is compressed first, and the configured limit then applies to the compressed result. A compressed result that still exceeds the limit SHALL be truncated as any other oversized result is, and SHALL disclose both that it was compressed and that it was truncated.

#### Scenario: Verbose command output is compressed
- **WHEN** a shell command produces output that compresses — repeated lines, a long listing, or output dominated by noise
- **THEN** the conversation receives the compressed form together with an indication that it was compressed

#### Scenario: Compressed output is not presented as verbatim
- **WHEN** the model receives a compressed command result
- **THEN** the result identifies itself as compressed rather than appearing to be the command's literal output

#### Scenario: A non-shell tool result is not compressed
- **WHEN** a tool that does not run a shell command produces a result
- **THEN** that result is not compressed, and the tool-result limit still applies to it

#### Scenario: Compressed output that is still oversized
- **WHEN** a shell command's output remains larger than the configured maximum after compression
- **THEN** the result is truncated as well, and states both that it was compressed and that it was truncated

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

### Requirement: A capability is advertised to the model under one name
The system SHALL NOT advertise the same capability to the model under more than one tool name. Where one advertised tool's behaviour is a special case of another's, only the general one SHALL be advertised, and the special case SHALL remain reachable through it.

Removing a name from what is advertised SHALL NOT remove a capability: everything the model could do before SHALL still be doable, through the tool that remains.

#### Scenario: A single sub-task is still possible
- **WHEN** the model needs to run one independent sub-task
- **THEN** it can do so through the tool that runs several, by requesting one, and the sub-task runs exactly as it would have under a dedicated single-task tool

#### Scenario: The redundant name is not advertised
- **WHEN** the tools advertised to the model are assembled
- **THEN** they contain no tool whose behaviour is a special case of another advertised tool's

#### Scenario: Every remaining capability is still advertised
- **WHEN** the advertised tools are compared against the capabilities the agent has
- **THEN** every capability is reachable through some advertised tool, and no argument of a remaining tool has been removed

### Requirement: Advertised tool definitions carry no text that restates the schema
The system SHALL NOT include, in a tool definition advertised to the model, description text whose content is already carried by the schema itself — an argument's name and type. Description text that states something the model could not infer from the name and type, such as a constraint on the value, SHALL be kept.

Every advertised tool SHALL keep its name, its arguments and which of them are required, unchanged. This requirement removes wording, never capability.

#### Scenario: A description that only restates the argument is removed
- **WHEN** an argument's description says only what its name and type already say
- **THEN** that description is absent from the advertised definition

#### Scenario: A description that carries a constraint is kept
- **WHEN** an argument's description states a constraint the model could not infer from the argument's name and type
- **THEN** that description is present in the advertised definition

#### Scenario: Arguments survive the removal of wording
- **WHEN** the advertised definitions are compared against the tools they describe
- **THEN** every tool advertises the same argument names, the same types, and the same required arguments as before

### Requirement: The agent's instructions do not repeat what the tool definitions say
The system SHALL NOT repeat, in its instruction text, information already carried by the tool definitions sent alongside it. Instruction text SHALL state what the tool definitions cannot: how the agent should behave, not what each tool does.

#### Scenario: A fact stated by the tool definitions is not restated
- **WHEN** the instruction text and the tool definitions are assembled for a request
- **THEN** the instruction text does not restate a fact that every tool definition already carries

#### Scenario: Behavioural guidance is retained
- **WHEN** the instruction text is shortened
- **THEN** the guidance that governs how the agent answers, and the direction to consult a skill before attempting a task it covers, are still present

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
