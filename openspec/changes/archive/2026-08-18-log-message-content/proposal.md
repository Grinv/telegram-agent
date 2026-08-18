## Why

Current logs only show metadata (chat ID, success/failure, timing) - when watching `npm run dev` locally, there's no way to see what a user actually asked or what the LLM actually replied, which makes it hard to eyeball that the bot is behaving sensibly while developing or demoing it.

## What Changes

- Log the incoming message text (the prompt sent to the LLM) at INFO level when a message is received.
- Log the LLM's reply text at INFO level when inference succeeds.
- Failure logs are unaffected - they already report the failure reason and detail; this change does not add prompt/response text to failure log entries.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `bot-orchestrator`: adds logging of the message prompt and the successful reply text, in addition to the chat ID metadata already logged.

## Impact

- `src/orchestrator.ts`: two additional `logger.info` calls (prompt on receipt, reply text on success); no change to control flow, error handling, or the one-shot/memoryless behavior.
- Console-only, local-dev-facing change: nothing is persisted to a file or sent anywhere external. Since message/response text will now appear in terminal output, anyone running the bot should be mindful of what's visible on their screen/terminal history if a chat contains sensitive text - no new risk beyond what the terminal already shows for other structured fields.
