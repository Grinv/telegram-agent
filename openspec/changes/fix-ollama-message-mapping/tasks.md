## 1. Fix message construction

- [ ] 1.1 In `src/llms/ollama/index.ts`, change `buildMessages()` so that when `request.messages` is non-empty it maps only those messages, in order, and does not prepend `request.prompt`. When `request.messages` is absent or empty, keep returning a single `{ role: 'user', content: request.prompt }`. Verify: `npx tsc --noEmit` passes.
- [ ] 1.2 In `toOllamaMessage()`, carry a `tool`-role message's `name` through to the emitted Ollama message (Ollama's chat API accepts `tool_name` on a `tool`-role message; confirm the field name against the running Ollama version and use whatever that version reads, rather than assuming). Verify: `npx tsc --noEmit` passes.

## 2. Tests

- [ ] 2.1 Add a test to `test/llms/ollama.test.ts` using the existing fake-`fetch` pattern: call `callLlm` with `prompt: "q2"` and `messages: [user "q1", assistant "a1", user "q2"]`, then assert the captured request body's `messages` array has exactly 3 entries, in that order, with `"q2"` appearing exactly once and last. Verify: `npm test` passes.
- [ ] 2.2 Add a test that a request with `prompt` and no `messages` still sends exactly one `user` message containing the prompt. Verify: `npm test` passes.
- [ ] 2.3 Add a test that two `tool`-role messages with different `name` values are sent with their respective tool names preserved and distinguishable. Verify: `npm test` passes.
- [ ] 2.4 Re-run the existing `test/llms/ollama.test.ts` cases and confirm none of them encoded the old duplicated-prompt behaviour; update any that did, and note in the task list which ones changed and why. Verify: `npm test` passes.

## 3. Final verification

- [ ] 3.1 Run `npm test` and `npx tsc --noEmit`; both must pass with no new failures. Verify: `npm test` exits 0 and `tsc` reports no errors.
- [ ] 3.2 Manually exercise one multi-iteration tool-use message against a running Ollama and confirm from the bot's logs that the loop still completes and the reply is sensible (the fix changes what the model sees, so a smoke check is warranted beyond unit tests). Verify: a tool-using message produces a correct final reply.
