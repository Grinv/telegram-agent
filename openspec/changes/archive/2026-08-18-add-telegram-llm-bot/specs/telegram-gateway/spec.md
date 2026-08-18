## Purpose

Provides a dependency-free client for the Telegram Bot API so the bot can receive user messages and send replies without a third-party SDK.

## ADDED Requirements

### Requirement: Long-poll for incoming messages
The system SHALL retrieve new incoming Telegram messages by long-polling the Bot API's update endpoint, without using any third-party Telegram client library.

#### Scenario: New message arrives
- **WHEN** a user sends a text message to the bot in Telegram
- **THEN** the gateway receives the message content and sender/chat identifiers within one polling cycle

#### Scenario: No new messages
- **WHEN** no new updates are available from Telegram
- **THEN** the gateway continues polling without error or duplicate processing

### Requirement: Send reply to originating chat
The system SHALL send a text reply back to the same Telegram chat the triggering message came from, via a direct HTTPS request to the Bot API.

#### Scenario: Successful reply delivery
- **WHEN** the bot has a response ready for a given chat
- **THEN** the gateway sends the response text to that chat via the Telegram Bot API and the message appears in the chat

### Requirement: Bot token confidentiality
The system SHALL read the Telegram bot token exclusively from environment configuration and SHALL NOT embed it in source code or version-controlled files.

#### Scenario: Token missing at startup
- **WHEN** the TELEGRAM_BOT_TOKEN environment variable is not set
- **THEN** the system fails to start with a clear configuration error instead of making API calls with an empty/invalid token

### Requirement: Non-text updates are ignored gracefully
The system SHALL ignore Telegram updates that do not contain plain text message content without crashing.

#### Scenario: Unsupported update type received
- **WHEN** an update is received that is not a plain text message (e.g., a sticker or an edited message)
- **THEN** the gateway skips it without error and continues processing subsequent updates
