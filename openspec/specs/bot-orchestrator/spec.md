## Purpose

Wires an incoming Telegram message to an LLM inference call and back to a reply, using the chat's persisted conversation history as context.

## Requirements

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

### Requirement: The /new command starts a fresh conversation
The system SHALL recognize an incoming message whose text is exactly `/new` as a command rather than a message to forward to the LLM. On receiving it, the system SHALL clear the persisted conversation history for that chat and reply with a confirmation message, without invoking the LLM or the think → act → observe loop for that message.

#### Scenario: Command clears an existing history
- **WHEN** a chat with existing persisted history sends `/new`
- **THEN** that chat's persisted history is cleared, no LLM call is made for this message, and the user receives a confirmation reply

#### Scenario: Command on a chat with no history
- **WHEN** a chat with no persisted history sends `/new`
- **THEN** the system still replies with a confirmation message and makes no LLM call, without error

#### Scenario: Command does not affect other chats
- **WHEN** one chat sends `/new`
- **THEN** the persisted history of every other chat remains unchanged

### Requirement: Reply reflects inference outcome
The system SHALL send the LLM's final response back to the user when the think → act → observe loop completes successfully, and SHALL send a user-facing error notice when inference fails (not configured, provider error, or timeout), when the LLM's response is empty and requests no tool call, or when an unexpected tool execution error prevents completion.

#### Scenario: Successful inference
- **WHEN** the LLM produces a final text response (either directly or after one or more tool-use iterations) for a user's message
- **THEN** the orchestrator sends that response back to the same chat

#### Scenario: Failed inference
- **WHEN** the LLM connector reports a failure (not configured, error, or timeout) for a user's message
- **THEN** the orchestrator sends a user-facing message indicating the request could not be completed, instead of leaving the user without any reply

#### Scenario: Tool execution fails
- **WHEN** a tool execution fails during the loop
- **THEN** the failure is fed back to the LLM as an observation so the LLM can attempt an alternative approach, and only if the loop cannot recover does the user receive a failure notice

#### Scenario: LLM returns an empty response with no tool call
- **WHEN** the LLM connector reports success but the response text is empty (or contains only whitespace) and requests no tool call
- **THEN** the orchestrator treats this as a failed exchange, sends the user-facing failure notice instead of attempting to deliver empty text, and never calls the message delivery step with an empty reply

### Requirement: No message is silently dropped
The system SHALL ensure every valid incoming text message results in either a reply or a logged failure record.

#### Scenario: Unexpected internal error while handling a message
- **WHEN** an unexpected error occurs while processing a message
- **THEN** the error is logged and the user still receives a failure notice for that message

#### Scenario: Max iterations reached
- **WHEN** the think → act → observe loop reaches the configured maximum number of iterations without the LLM producing a final answer
- **THEN** the system sends a user-facing message indicating the request could not be completed in the allowed steps, and logs the iteration count

### Requirement: Message and reply content are logged
The system SHALL log the text of an incoming message when it is received, SHALL log the text of the LLM's final reply when the loop completes successfully, and SHALL log each tool call requested by the LLM and its result during the loop.

#### Scenario: Message received
- **WHEN** a text message is received from a chat
- **THEN** a log entry is emitted containing that message's text

#### Scenario: Successful reply
- **WHEN** the LLM produces a final response for a message
- **THEN** a log entry is emitted containing the reply text that will be sent back to the chat

#### Scenario: Tool call executed
- **WHEN** the LLM requests a tool call during the loop
- **THEN** a log entry is emitted containing the tool name, its arguments, and the result (success or failure) of the execution

### Requirement: Think → act → observe loop
The system SHALL implement a think → act → observe loop for each message: (1) send the user message and available tool definitions to the LLM, (2) if the LLM returns tool calls, execute them in a fresh sandbox and collect the results, (3) feed the results back to the LLM as observations, and (4) repeat until the LLM returns a final text answer or the maximum iteration count is reached.

#### Scenario: LLM answers directly without tools
- **WHEN** the LLM returns a final text response on the first call (no tool calls)
- **THEN** the orchestrator sends that response as the reply without entering the act/observe steps

#### Scenario: LLM uses a tool then answers
- **WHEN** the LLM requests a tool call, receives the observation, and then returns a final text response
- **THEN** the orchestrator sends the final text response as the reply, and the intermediate tool call and its result are logged

#### Scenario: LLM chains multiple tool calls across iterations
- **WHEN** the LLM requests tool calls in multiple consecutive iterations before producing a final answer
- **THEN** each iteration's tool calls are executed in a fresh sandbox, results are fed back, and the loop continues until a final answer or the iteration cap

### Requirement: Loop is extracted as a reusable function
The system SHALL implement the think → act → observe loop as a standalone function (`runLoop`) that accepts messages, tools, and dependencies as parameters, so that a later change can invoke the loop recursively (e.g. for subagents) without duplicating orchestrator logic or modifying the orchestrator module.

#### Scenario: runLoop is callable independently of createMessageHandler
- **WHEN** a caller invokes `runLoop` directly with a message, tool definitions, and injected dependencies (callLlm, sandboxExecutor, toolRegistry)
- **THEN** the loop executes and returns either a final text answer or a loop-exhausted failure, without requiring the full message-handler wiring (Telegram client, etc.)

### Requirement: Loop falls back to one-shot when no tools are available
The system SHALL process messages using a single LLM call without entering the act/observe loop when no tools are registered, preserving the original one-shot behavior.

#### Scenario: No tools registered
- **WHEN** the tool registry is empty and a message arrives
- **THEN** the orchestrator sends the message to the LLM and sends the response back directly, with no sandbox spawning

### Requirement: Stats recording is optional and injectable
The system SHALL accept an optional `statsRecorder` dependency in the orchestrator. When `statsRecorder` is `undefined`, the loop SHALL operate normally without recording any statistics. When a `statsRecorder` is provided, the loop SHALL report timing, iteration count, tool call count, and LLM call results to it at defined hook points (message received, each LLM call, each tool call, reply sent). This holds on every code path that ends in a reply to the user, including an unexpected internal error, not only the typed loop success/failure outcomes. The orchestrator SHALL depend only on the stats recorder interface, not on any specific implementation.

#### Scenario: No stats recorder provided
- **WHEN** the orchestrator is created without a `statsRecorder` dependency
- **THEN** the loop runs normally and no statistics are recorded, and no errors or warnings are emitted about the missing recorder

#### Scenario: Stats recorder provided
- **WHEN** the orchestrator is created with a `statsRecorder` dependency
- **THEN** at each hook point (message received, LLM call completed, tool call completed, reply sent), the recorder receives the relevant timing and count data

#### Scenario: Stats recorder provided and an unexpected error occurs
- **WHEN** an unexpected internal error occurs while handling a message and a `statsRecorder` is provided
- **THEN** the recorder still receives the reply-sent hook data for that message, marked as failed with a reason identifying the error, instead of never being told the message finished

### Requirement: Every request begins with the agent's instructions
The system SHALL begin every request it sends to the model with a system instruction describing what the agent is and what it can do, including the skill index when skills are available. This instruction is generated by the system, not supplied by the user.

The instruction SHALL NOT be presented to the user, SHALL NOT be treated as part of the conversation between the user and the agent, and SHALL be present on every iteration of the think → act → observe loop, not only the first.

#### Scenario: First request of a message
- **WHEN** the agent sends its first request for an incoming message
- **THEN** the request carries the agent's system instruction ahead of the user's turn

#### Scenario: Later iterations of the same loop
- **WHEN** the agent sends a follow-up request after executing a tool call
- **THEN** that request also carries the system instruction

#### Scenario: Instruction is not conversation
- **WHEN** the agent replies to the user
- **THEN** the reply contains no part of the system instruction, and the instruction is not recorded as a turn of the user-facing conversation
</content>
