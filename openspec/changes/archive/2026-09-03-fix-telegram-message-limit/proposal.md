## Why

The Telegram Bot API rejects a `sendMessage` whose text exceeds 4096 characters. The gateway never checks the length, and the consequences compound into a silent correctness and measurement failure:

1. The agent finishes successfully and produces a long answer.
2. `sendMessage` gets HTTP 400 and throws.
3. The orchestrator's `catch` block treats it as an unexpected error and sends the generic failure notice instead — so the user is told the bot could not process their message, even though it did.
4. The success statistics were **already** written one step earlier, before the send was attempted. The failure path's second write is a no-op, because the recorder drops its pending row on the first finalizing write.

The result is that every reply over 4096 characters is recorded as a success and delivered as a failure. Recorded success rate is therefore inflated exactly on long answers — and success rate is the quality gate for the upcoming token-optimization work, which must not regress it by more than 2 percentage points. A baseline measured on today's behaviour would be measuring a lie, so this is fixed before any benchmark is taken.

Point 4 is also already a defect against the existing `agent-stats` requirement, whose success scenario reads "LLM returns a final answer, **reply is sent**".

## What Changes

- A reply longer than the platform's per-message limit is delivered as several messages in order, split on a sensible boundary, instead of failing. The user sees the whole answer.
- Per-message statistics are finalized only after delivery has been attempted, so a delivery failure is recorded as a failure rather than a success.
- A delivery that fails partway through a multi-part reply is recorded as a failure, with the failure attributable to delivery rather than to inference.

Explicitly **not** in scope: sending long content as a file attachment. Nothing in the system currently sends a report to a chat; the observability dashboard is a CLI. That option can be added when something actually needs it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `telegram-gateway`: the "Send reply to originating chat" requirement is extended to cover replies longer than the platform's per-message limit.
- `agent-stats`: the "Per-message statistics are recorded" requirement is extended so that a reply that could not be delivered is recorded as a failure, not a success.

## Impact

- `src/telegram/client.ts` — `sendMessage` splits over-long text and sends the parts in order.
- `src/orchestrator.ts` — the finalizing `recordMessage` call moves to after the reply is delivered; delivery failure produces a distinct failure reason.
- `test/telegram/client.test.ts`, `test/orchestrator.test.ts` — new cases.
- No schema change: the existing `messages.ok`/`messages.reason` columns already carry this. No config or env change.
- Recorded success rate will drop for any workload that produces long replies. That drop is a correction, not a regression — it is the point of the change.
