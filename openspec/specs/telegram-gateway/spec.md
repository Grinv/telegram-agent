## Purpose

Provides a dependency-free client for the Telegram Bot API so the bot can receive user messages and send replies without a third-party SDK.

## Requirements

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

The Telegram Bot API rejects a single message longer than 4096 characters. When a reply exceeds that limit, the system SHALL deliver the reply as a sequence of messages, each within the limit, sent to the same chat in order, so that reading them in the order received reproduces the entire reply with no content lost, added, or reordered. The system SHALL prefer to break the reply at a line boundary, and failing that at a word boundary, so that parts do not split mid-word where avoidable. The system SHALL NOT split a multi-code-unit character across two parts.

Delivery SHALL be reported as successful only if every part was accepted by the Bot API. If any part is rejected, the system SHALL report the delivery as failed, naming delivery — not inference — as the cause.

#### Scenario: Successful reply delivery
- **WHEN** the bot has a response ready for a given chat
- **THEN** the gateway sends the response text to that chat via the Telegram Bot API and the message appears in the chat

#### Scenario: Reply within the limit is sent as one message
- **WHEN** a reply of 4096 characters or fewer is delivered
- **THEN** exactly one message is sent to the chat, containing the reply unchanged

#### Scenario: Over-long reply is delivered in parts
- **WHEN** a reply longer than 4096 characters is delivered
- **THEN** it is sent as two or more messages to the same chat, each within the limit, in order, and concatenating them in the order sent reproduces the original reply exactly

#### Scenario: Parts break at a line boundary when one is available
- **WHEN** an over-long reply contains line breaks within reach of the limit
- **THEN** the break between parts falls at a line boundary rather than mid-line

#### Scenario: A part is rejected by the API
- **WHEN** the Bot API rejects one of the parts of a multi-part reply
- **THEN** the delivery is reported as failed, and the failure is attributed to delivery rather than to the agent's inference

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
