## 1. Logging

- [x] 1.1 In `src/orchestrator.ts`, log the incoming message's prompt text at INFO level when a message is received
- [x] 1.2 In `src/orchestrator.ts`, log the LLM's reply text at INFO level alongside the existing "Inference succeeded" log entry

## 2. Tests

- [x] 2.1 Update/add orchestrator tests asserting the logged fields include the prompt text on receipt and the reply text on success (capture `logger` calls, e.g. via a fake or spy, rather than asserting on console output)
