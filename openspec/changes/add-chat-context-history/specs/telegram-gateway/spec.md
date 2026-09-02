## MODIFIED Requirements

### Requirement: Long-poll for incoming messages
The system SHALL retrieve new incoming Telegram messages by long-polling the Bot API's update endpoint, without using any third-party Telegram client library. The message object returned to callers SHALL include the sender's Telegram user ID and a display name (username, or first name if no username is set), in addition to the chat ID and message text.

#### Scenario: New message arrives
- **WHEN** a user sends a text message to the bot in Telegram
- **THEN** the gateway receives the message content and sender/chat identifiers within one polling cycle

#### Scenario: No new messages
- **WHEN** no new updates are available from Telegram
- **THEN** the gateway continues polling without error or duplicate processing

#### Scenario: Sender identity is exposed to callers
- **WHEN** a text message is received from a user
- **THEN** the returned message object exposes that user's Telegram ID and a display name (username or first name), so callers can attribute the message to its sender
