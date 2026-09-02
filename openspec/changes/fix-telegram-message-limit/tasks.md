## 1. Split over-long replies in the gateway

- [ ] 1.1 In `src/telegram/client.ts`, add a pure exported function that takes a string and a limit and returns the parts to send: it returns a single-element array when the text is within the limit, and otherwise breaks at the last line boundary within the limit, falling back to the last word boundary, then to a hard cut at the limit, never splitting a surrogate pair. Verify: `npx tsc --noEmit` passes.
- [ ] 1.2 Change `TelegramClient.sendMessage` to split the text with that function and send the parts sequentially, in order, awaiting each before sending the next, and to reject if any part is rejected. Keep the `TelegramReplier` interface (`sendMessage(chatId, text): Promise<void>`) unchanged so existing callers and fakes are unaffected. Verify: `npx tsc --noEmit` passes and existing `test/telegram/client.test.ts` cases still pass.

## 2. Gateway tests

- [ ] 2.1 In `test/telegram/client.test.ts`, unit-test the splitting function directly: text within the limit yields one part unchanged (covers spec scenario "Reply within the limit is sent as one message"). Verify: `npm test` passes.
- [ ] 2.2 Test that text over the limit yields parts that are each within the limit and whose concatenation equals the input exactly (covers "Over-long reply is delivered in parts"). Verify: `npm test` passes.
- [ ] 2.3 Test that a text with line breaks near the limit splits at a line boundary, and that a text with no line breaks but with spaces splits at a word boundary (covers "Parts break at a line boundary when one is available"). Verify: `npm test` passes.
- [ ] 2.4 Test that a text whose character at the limit is one half of a surrogate pair (e.g. long runs of emoji) is not split through that pair — every part must round-trip without replacement characters. Verify: `npm test` passes.
- [ ] 2.5 Test with a fake `fetch` that `sendMessage` with over-long text issues one API call per part, in order, and that when the fake rejects the second call the returned promise rejects (covers "A part is rejected by the API"). Verify: `npm test` passes.

## 3. Finalize statistics after delivery

- [ ] 3.1 In `src/orchestrator.ts`'s `handleMessage`, move the finalizing `deps.statsRecorder?.recordMessage({ ... ok, iterations })` call to after `await deps.client.sendMessage(...)` succeeds, so a delivery failure is not preceded by a recorded success. Verify: `npx tsc --noEmit` passes.
- [ ] 3.2 Record a delivery failure with a failure reason distinct from the inference failure reasons already in use (e.g. `DELIVERY_FAILED`), so reports can separate "the agent failed" from "the agent worked but the reply could not be delivered". Ensure the existing generic `catch` still sends the user-facing failure notice and still cannot mask the reason. Verify: `npx tsc --noEmit` passes.

## 4. Orchestrator tests

- [ ] 4.1 In `test/orchestrator.test.ts`, add a test with a fake client whose `sendMessage` rejects: assert the message is recorded with `ok: false` and the delivery-specific reason, and that it is never recorded with `ok: true` (covers spec scenarios "Reply is produced but cannot be delivered" and "Success is not recorded before delivery"). Verify: `npm test` passes.
- [ ] 4.2 Add a test asserting call ordering on the happy path: with a fake recorder and fake client, the successful `recordMessage` finalization happens after `sendMessage` resolves. Verify: `npm test` passes.
- [ ] 4.3 Confirm the existing orchestrator tests that assert success recording still pass, and update any that depended on the finalization happening before delivery; note in this task which ones changed and why. Verify: `npm test` passes.

## 5. Final verification

- [ ] 5.1 Run `npm test` and `npx tsc --noEmit`; both must pass with no new failures. Verify: `npm test` exits 0 and `tsc` reports no errors.
- [ ] 5.2 Send a message to the running bot that provokes a reply longer than 4096 characters (e.g. ask it to print a long file via `execute_command`) and confirm the full answer arrives in the chat as consecutive messages and the run is recorded with `ok=1`. Verify: the chat shows the complete reply and `data/stats.db` records the message as successful.
