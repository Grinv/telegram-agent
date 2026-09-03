## Purpose

Persists the ordered conversation history for each Telegram chat across messages and process restarts, tagged with who sent each turn, so the orchestrator can give the LLM the full conversation instead of a single isolated message.

## Requirements

### Requirement: Conversation history is persisted per chat
The system SHALL persist an ordered sequence of conversation turns (user messages and assistant replies) for each chat ID to a local SQLite database, surviving process restarts.

#### Scenario: History survives a restart
- **WHEN** a chat has prior turns recorded and the bot process is restarted
- **THEN** the next message for that chat is processed with the previously recorded turns still available as history

#### Scenario: New chat has no history
- **WHEN** a message arrives for a chat ID with no prior recorded turns
- **THEN** the history returned for that chat is empty and the new message becomes its first turn

### Requirement: Stored user turns are attributed to a sender
The system SHALL record, for each stored user turn, the sender's Telegram user ID and a display name (username or first name) alongside the message text.

#### Scenario: Turn recorded with sender identity
- **WHEN** a user sends a message in a chat
- **THEN** the stored turn includes that user's Telegram ID and display name together with the message text

#### Scenario: Group chat with multiple senders
- **WHEN** two different users send messages in the same group chat
- **THEN** the chat's history contains both turns, each attributed to its own sender's ID and display name, in the order sent

### Requirement: History is appended after each exchange
The system SHALL append the user's turn to the chat's history when a message is received and SHALL append the assistant's final reply to the same chat's history once the reply is successfully produced.

#### Scenario: Successful exchange is recorded
- **WHEN** a message is processed and the LLM produces a final reply that is sent to the chat
- **THEN** both the user's turn and the assistant's reply are appended to that chat's persisted history, in that order

#### Scenario: Failed exchange does not record an assistant turn
- **WHEN** a message is processed but inference fails or the loop is exhausted (no reply produced)
- **THEN** the user's turn is still appended to history, but no assistant turn is appended for that failed attempt

### Requirement: History grows without an automatic limit
The system SHALL NOT automatically truncate, summarize, or expire a chat's persisted history based on age or length; history for a chat SHALL only shrink via an explicit clear operation.

#### Scenario: Long-running chat keeps all turns
- **WHEN** a chat has accumulated many turns over time
- **THEN** all of them remain in the persisted history and are available to be loaded, with no automatic pruning

### Requirement: History can be cleared per chat
The system SHALL provide an operation to permanently delete all persisted history for a given chat ID, independent of any other chat's history.

#### Scenario: Clearing one chat does not affect another
- **WHEN** history is cleared for one chat ID
- **THEN** the persisted history for every other chat ID remains unchanged

#### Scenario: Clearing an already-empty chat
- **WHEN** history is cleared for a chat ID with no recorded turns
- **THEN** the operation completes without error and the chat's history remains empty

### Requirement: History storage is independent of statistics recording
The system SHALL persist conversation history in a database separate from the agent-stats database, and clearing a chat's conversation history SHALL have no effect on any previously or subsequently recorded statistics.

#### Scenario: Clearing history leaves stats intact
- **WHEN** a chat's conversation history is cleared
- **THEN** previously recorded message/LLM-call/tool-call statistics for that chat remain in the stats database, unaffected by the clear
