## Purpose

Wires an incoming Telegram message to an LLM inference call and back to a reply, treating every message as an independent, memoryless request.

## ADDED Requirements

### Requirement: One-shot message handling
The system SHALL process each incoming message independently, without using or storing any prior conversation history for that or any other chat.

#### Scenario: Two consecutive messages from the same user
- **WHEN** a user sends a second message after receiving a reply to their first
- **THEN** the second message is processed using only its own content, with no reference to the first message or its reply

### Requirement: Reply reflects inference outcome
The system SHALL send the LLM's response back to the user when inference succeeds, and SHALL send a user-facing error notice when inference fails (not configured, provider error, or timeout).

#### Scenario: Successful inference
- **WHEN** the LLM connector returns a response for a user's message
- **THEN** the orchestrator sends that response back to the same chat

#### Scenario: Failed inference
- **WHEN** the LLM connector reports a failure (not configured, error, or timeout) for a user's message
- **THEN** the orchestrator sends a user-facing message indicating the request could not be completed, instead of leaving the user without any reply

### Requirement: No message is silently dropped
The system SHALL ensure every valid incoming text message results in either a reply or a logged failure record.

#### Scenario: Unexpected internal error while handling a message
- **WHEN** an unexpected error occurs while processing a message
- **THEN** the error is logged and the user still receives a failure notice for that message
