## REMOVED Requirements

### Requirement: One-shot message handling
**Reason**: The bot now maintains per-chat conversation history (see `chat-context-history`) instead of treating every message as independent; this is superseded by the "History-aware message handling" requirement below.
**Migration**: No user-facing migration needed. Existing single-message behavior is preserved for a chat's first message (empty history); subsequent messages in the same chat now include prior turns.

The system SHALL process each incoming message independently, without using or storing any prior conversation history for that or any other chat. Within a single message's handling, the system MAY run a multi-step think → act → observe loop (LLM call, tool execution, observation fed back), but no state from that loop SHALL persist after the reply is sent.

#### Scenario: Two consecutive messages from the same user
- **WHEN** a user sends a second message after receiving a reply to their first
- **THEN** the second message is processed using only its own content, with no reference to the first message, its reply, or any intermediate tool results from the first message's loop

## ADDED Requirements

### Requirement: History-aware message handling
The system SHALL, for each incoming message, load the persisted conversation history for that chat, append the new user turn to it, and send the resulting ordered conversation to the LLM as the think → act → observe loop's message list. Within a single message's handling, the system MAY still run a multi-step think → act → observe loop (LLM call, tool execution, observation fed back); intermediate tool-call/observation messages from that loop SHALL NOT be persisted to the chat's history — only the final user turn and the final assistant reply are persisted.

#### Scenario: Two consecutive messages from the same user
- **WHEN** a user sends a second message after receiving a reply to their first
- **THEN** the second message is processed with the first message and its reply included as prior turns in the conversation sent to the LLM

#### Scenario: Intermediate tool loop state is not persisted
- **WHEN** a message's think → act → observe loop executes one or more tool calls before producing a final answer
- **THEN** the persisted chat history after the exchange contains only the user's turn and the assistant's final reply, not the intermediate tool-call/observation messages

#### Scenario: First message in a new chat
- **WHEN** a chat has no prior persisted history
- **THEN** the message is processed using only its own content, equivalent to prior one-shot behavior

### Requirement: Reset-context command clears chat history
The system SHALL recognize an incoming message whose text is exactly `/reset-context` as a command rather than a message to forward to the LLM. On receiving it, the system SHALL clear the persisted conversation history for that chat and reply with a confirmation message, without invoking the LLM or the think → act → observe loop for that message.

#### Scenario: Reset command clears history
- **WHEN** a chat with existing persisted history sends `/reset-context`
- **THEN** that chat's persisted history is cleared, no LLM call is made for this message, and the user receives a confirmation reply

#### Scenario: Reset command on a chat with no history
- **WHEN** a chat with no persisted history sends `/reset-context`
- **THEN** the system still replies with a confirmation message and makes no LLM call, without error

#### Scenario: Reset command does not affect other chats
- **WHEN** one chat sends `/reset-context`
- **THEN** the persisted history of every other chat remains unchanged
