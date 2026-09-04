Sequencing note: land second — after `fix-context-attribution`, before `add-token-optimizations`. The attribution fix comes first so the spans carry corrected figures from the start rather than a defect that has to be re-exported once it is fixed. This change is additive — it alters neither what is sent to the model nor what the SQLite recorder writes — so the frozen baseline in `benchmark/baseline.md` stays valid across it; task 6.1 re-runs the benchmark against that baseline to verify rather than assume it.

## 1. Decide on the dependency before depending on it

- [x] 1.1 Install the OpenTelemetry API, SDK and OTLP trace exporter, and record in this change's notes the resulting count of `node_modules` packages against the current 9 and the runtime dependency count against the current 1 (see design.md — Risks). Verify: both before and after counts are written down.
- [x] 1.2 Review that count against the supply-chain constraint in `openspec/config.yaml` before writing any code that imports the SDK, and record the decision to proceed or to stop (see design.md — Risks). Verify: the decision and its reason are recorded.

## 2. Configuration

- [x] 2.1 Add a pure resolver for the export endpoint to `src/config.ts`, defaulting to unset, following the existing `resolve*` pattern. Verify: `npx tsc --noEmit` passes.
- [x] 2.2 Test that the endpoint is unset by default and that setting it is reflected in the loaded config (covers "Default configuration exports nothing"), in `test/config.test.ts`. Verify: `npm test` passes.

## 3. The exporter

- [x] 3.1 Add a `StatsRecorder` implementation in `src/stats/` that opens a span per message, a child span per LLM call and a child span per tool call, carrying the measurements each `record*` call already receives (see `src/stats/types.ts`). Verify: `npx tsc --noEmit` passes.
- [x] 3.2 Nest a sub-agent's LLM-call spans beneath the tool-call span that spawned them, using the recorded `agentId`/`role` fields. Verify: `npx tsc --noEmit` passes.
- [x] 3.3 Omit an attribute whose value was never reported rather than writing zero — cached and reasoning tokens in particular. Verify: `npx tsc --noEmit` passes.
- [x] 3.4 Honour `STATS_STORE_PROMPTS` in the exporter so prompt and reply text is not sent to a network destination when it is not stored locally, defaulting to the more private reading (see design.md — Risks). Verify: `npx tsc --noEmit` passes.
- [x] 3.5 Test that a message with two LLM calls and a tool call between them produces one message span with the three child spans, each carrying its recorded measurements (covers "A message that used tools produces a nested trace"), against an in-memory span exporter rather than a network endpoint. Verify: `npm test` passes.
- [x] 3.6 Test that sub-agent LLM-call spans appear beneath the spawning tool call's span rather than as siblings of the message's own LLM calls (covers "Sub-agent work is attributed to the tool call that started it"). Verify: `npm test` passes.
- [x] 3.7 Test that a failed message is exported with its failure and reason rather than omitted or marked successful (covers "A failed message is exported as failed"). Verify: `npm test` passes.
- [x] 3.8 Test that an LLM call's category split and repeated/new input counts appear on its span, including the tool-definition category `fix-context-attribution` introduces (covers "Category and repetition figures reach the destination"). Verify: `npm test` passes.
- [x] 3.9 Test that a call whose derived figures were not computed omits those attributes instead of carrying zeroes (covers "A call whose derived figures could not be computed"). Verify: `npm test` passes.
- [x] 3.10 Test that a call whose provider reported no cached-token count omits that attribute rather than setting it to zero (covers "Provider reports no cached-token count"). Verify: `npm test` passes.
- [x] 3.11 Test that prompt and reply text is absent from exported spans when prompt storage is disabled. Verify: `npm test` passes.

## 4. Composition and isolation from the existing recorder

- [x] 4.1 Add a composite `StatsRecorder` that forwards each call to the SQLite recorder and the exporter, and wire it in `src/index.ts` so the exporter is composed in only when an endpoint is configured (see design.md — Decisions). Leave `src/orchestrator.ts` unchanged. Verify: `npx tsc --noEmit` passes and `git diff src/orchestrator.ts` is empty.
- [x] 4.2 Test that with no endpoint configured the SDK is not started and nothing is exported, while local recording is unaffected (covers "No destination configured"). Verify: `npm test` passes.
- [x] 4.3 Test that with an endpoint configured a handled message's trace is sent to it, using a fake endpoint rather than a real collector (covers "Operator configures a destination"). Verify: `npm test` passes.
- [x] 4.4 Test that the composite recorder writes to the SQLite recorder exactly what the SQLite recorder receives today, so composition cannot change recorded rows. Verify: `npm test` passes.

## 5. Failure behaviour

- [x] 5.1 Send spans through a bounded, batched, non-blocking queue that drops spans when full rather than growing (see design.md — Decisions). Verify: `npx tsc --noEmit` passes.
- [x] 5.2 Swallow export failures and log the transition into and out of a failing state rather than one entry per failed span. Verify: `npx tsc --noEmit` passes.
- [x] 5.3 Test that an unreachable endpoint still lets the reply be sent and the local statistics be recorded, with the failure logged (covers "Export destination is unreachable"). Verify: `npm test` passes.
- [x] 5.4 Test that an endpoint slower than the time it takes to handle a message does not delay the reply (covers "Export destination is slow"). Verify: `npm test` passes.
- [x] 5.5 Test that an endpoint down across many handled messages does not produce one log entry per unexported span (covers "Export destination stays down"). Verify: `npm test` passes.
- [x] 5.6 Test that a local database write failure still only warns and lets handling continue, unchanged by the exporter's presence (covers the existing "Database write fails" scenario under the modified requirement). Verify: `npm test` passes.

## 6. Prove the benchmark is untouched

- [x] 6.1 Run the benchmark with export disabled and compare against the existing baseline snapshot, confirming per-task tokens, cost, turns, tool calls and correctness are identical (see design.md — Risks). Verify: the comparison reports no difference.
- [x] 6.2 Confirm `benchmark/` is unmodified by this change, so the frozen task set and its baseline stay valid. Verify: `git diff` over `benchmark/` shows no change.

## 7. Deployment and documentation

- [x] 7.1 Add an optional, not-started-by-default collector service to `docker-compose.yml` for operators who want somewhere to send traces. Verify: `docker compose config` succeeds and `docker compose up` starts the same services as before.
- [x] 7.2 Document the export endpoint, its unset default, what an operator gains by setting it, and that nothing leaves the machine until they do, in `.env.example` and `README.md`. Verify: the setting and its default are documented in both.
- [x] 7.3 Document in `DEPLOYMENT.md` what enabling export means for the isolated/microVM deployment's containment boundary. Verify: the isolated-deployment section states it.
- [x] 7.4 Amend the supply-chain constraint in `openspec/config.yaml` to record this exception and its bound, so a later reader is not left to infer whether the rule still holds (see proposal.md — What Changes). Verify: the amended constraint names the exception.
- [x] 7.5 Record in this change's notes that the change is additive — no view, command or default behaviour was removed — and what it therefore does and does not save (see proposal.md — What Changes). Verify: the note is written.

## 8. Final verification

- [x] 8.1 Run `npm test` and `npm run typecheck`; both must pass with no new failures. Verify: `npm test` exits 0 and the type check reports no errors.
- [x] 8.2 Start the bot with no endpoint configured and confirm it handles a message, records locally, and starts no exporter. Verify: the reply is delivered and the stats database has the message's rows.
