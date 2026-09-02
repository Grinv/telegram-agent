## Why

`createMessageHandler`'s `handleMessage` (`src/orchestrator.ts`) wraps the whole message-handling flow in a try/catch to guarantee the user always gets a failure notice on an unexpected error. But that catch block only logs and sends the failure reply — it never calls `deps.statsRecorder?.recordMessage(...)` for the completion hook. As a result, when an unexpected exception occurs (a bug, a thrown error from a dependency), the stats recorder only ever sees the "received" hook for that message, never "reply sent." A `SqliteStatsRecorder`-backed database is left with that message's row stuck at its initial insert values (`ok=0, total_ms=0, reason=NULL`), indistinguishable from any other zero-duration failure and never reflecting how long processing actually ran before it broke. This violates the existing `bot-orchestrator` spec requirement that the stats recorder receives data "at each hook point ... reply sent" regardless of outcome.

## What Changes

- `handleMessage`'s catch block calls `deps.statsRecorder?.recordMessage(...)` with `ok: false`, a `replySentAt` timestamp, and a `reason` identifying this as an unexpected error (distinct from `LlmFailureReason`/`MAX_ITERATIONS`), before or alongside sending the failure notice.
- No change to the `StatsRecorder` interface or `SqliteStatsRecorder` — both already accept and persist a `reason` string; this only closes the call site that was skipping the hook.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `bot-orchestrator`: the "Stats recording is optional and injectable" requirement gains an explicit scenario covering the unexpected-error path, so the recorder reliably receives the reply-sent hook on every code path, not just the typed `LoopResult` failure/success paths.

## Impact

- `src/orchestrator.ts`: add a `statsRecorder?.recordMessage(...)` call inside the existing catch block.
- `test/orchestrator.test.ts`: new test asserting the stats hook fires on an unexpected (thrown) error.
- No database schema change, no new dependencies.
