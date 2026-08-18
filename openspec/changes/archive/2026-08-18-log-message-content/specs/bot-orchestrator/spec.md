## ADDED Requirements

### Requirement: Message and reply content are logged
The system SHALL log the text of an incoming message when it is received, and SHALL log the text of the LLM's reply when inference succeeds.

#### Scenario: Message received
- **WHEN** a text message is received from a chat
- **THEN** a log entry is emitted containing that message's text

#### Scenario: Successful reply
- **WHEN** the LLM connector returns a successful response for a message
- **THEN** a log entry is emitted containing the reply text that will be sent back to the chat
