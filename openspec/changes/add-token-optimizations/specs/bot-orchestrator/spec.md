## MODIFIED Requirements

### Requirement: History-aware message handling
The system SHALL, for each incoming message, load the persisted conversation history for that chat, append the new user turn to it, and send the resulting ordered conversation to the LLM as the think → act → observe loop's message list. When that conversation exceeds the configured size, the system SHALL send it compacted rather than in full, as described by the `context-management` capability; the stored conversation is unaffected. Within a single message's handling, the system MAY still run a multi-step think → act → observe loop (LLM call, tool execution, observation fed back); intermediate tool-call/observation messages from that loop SHALL NOT be persisted to the chat's history — only the final user turn and the final assistant reply are persisted.

The agent's own generated instructions SHALL NOT be persisted as conversation history, and SHALL be assembled from current configuration for each request rather than replayed from storage, so that changing the agent's instructions takes effect on the next message rather than being frozen into past conversations.

An assistant reply SHALL be persisted only once it has been delivered to the chat. A reply that was produced but could not be delivered SHALL NOT appear in the history, so the stored conversation matches what the user actually saw.

#### Scenario: Two consecutive messages from the same user
- **WHEN** a user sends a second message after receiving a reply to their first
- **THEN** the second message is processed with the first message and its reply included as prior turns in the conversation sent to the LLM

#### Scenario: Intermediate tool loop state is not persisted
- **WHEN** a message's think → act → observe loop executes one or more tool calls before producing a final answer
- **THEN** the persisted chat history after the exchange contains only the user's turn and the assistant's final reply, not the intermediate tool-call/observation messages

#### Scenario: First message in a new chat
- **WHEN** a chat has no prior persisted history
- **THEN** the message is processed using only its own content, equivalent to prior one-shot behavior

#### Scenario: Generated instructions are not stored as history
- **WHEN** a message is handled and the agent's instructions are included in the request sent to the LLM
- **THEN** those instructions are not written to the chat's persisted history, and the next message's request carries instructions assembled again rather than loaded from storage

#### Scenario: Undelivered reply is not persisted
- **WHEN** the agent produces a final answer for a message but delivering it to the chat fails
- **THEN** the chat's persisted history contains the user's turn and no assistant turn for that exchange

#### Scenario: Conversation past the configured size is sent compacted
- **WHEN** a chat's stored conversation exceeds the configured size and a new message is handled
- **THEN** the request sent to the LLM carries a compacted conversation rather than every stored turn, while the stored conversation remains complete
