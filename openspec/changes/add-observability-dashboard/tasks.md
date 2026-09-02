Sequencing note: land after `extend-observability-instrumentation`. Every figure these views report comes from columns that change adds — per-call timestamps, cost, agent identity, category attribution, repeated-input measurement — and tool durations are zero until it lands. Building these views first would mean writing queries against columns that do not exist and tests that assert zeroes.

## 1. Query layer

- [ ] 1.1 Add a module under `src/stats/` holding the read queries for the three views, separate from rendering, so each query can be unit-tested against a temporary database without producing text. Verify: `npx tsc --noEmit` passes.
- [ ] 1.2 Add a test helper that builds a temporary stats database populated with a known fixture — several tasks, multiple turns, several tools, at least one unpriced model, and at least one row whose cached-token count was never reported. Verify: the helper is used by the tests below and each can assert exact numbers.

## 2. Summary view

- [ ] 2.1 Implement the summary view: tasks completed, input/output/cached token totals, total estimated cost, average tokens/turns/tool calls per task, and tools ranked by share of total tokens. Verify: `npx tsc --noEmit` passes.
- [ ] 2.2 Test it against the fixture and assert every reported figure equals the value computed from the fixture by hand (covers "Summary over recorded activity"). Verify: `npm test` passes.
- [ ] 2.3 Test the summary against an empty database: it reports no data and exits successfully, without printing zeroes as measurements (covers "Summary over an empty database"). Verify: `npm test` passes.

## 3. Timeline view

- [ ] 3.1 Implement the single-task timeline: turns in order, each with its LLM token count, and the tool calls made in that turn with their result sizes. Verify: `npx tsc --noEmit` passes.
- [ ] 3.2 Test it against a fixture task with several turns and tool calls: turns appear in order, each turn's tool calls appear under it, and the numbers match the fixture (covers "Timeline of a multi-turn task"). Verify: `npm test` passes.
- [ ] 3.3 Test that requesting an unknown task identifier reports "not found" and exits successfully (covers "Timeline of an unknown task"). Verify: `npm test` passes.

## 4. Analysis view

- [ ] 4.1 Implement the analysis view: tools ranked by token share, the most expensive turn with its input token count, input divided by content category, and repeated versus new input proportions. Verify: `npx tsc --noEmit` passes.
- [ ] 4.2 Test that it ranks tools correctly and names the turn the fixture makes most expensive (covers "Analysis identifies the largest consumers"). Verify: `npm test` passes.
- [ ] 4.3 Test that the reported category shares account for the input tokens they describe, with no unattributed remainder (covers "Categories account for the reported input"). Verify: `npm test` passes.

## 5. Honest reporting of missing data

- [ ] 5.1 Report a cache hit rate only over calls whose provider actually reported cached tokens; otherwise mark it unavailable. Test with a fixture where no call reported cached tokens that the output says unavailable rather than 0% (covers "Provider reported no cache statistics"). Verify: `npm test` passes.
- [ ] 5.2 Indicate in any cost total that part of the activity was unpriced, when it was. Test with a fixture containing an unpriced model (covers "Unpriced models in a cost total"). Verify: `npm test` passes.
- [ ] 5.3 Exclude rows whose values are migration defaults rather than measurements from that field's aggregates, or mark the aggregate partial. Test with a fixture containing pre-migration rows, identified by their null timestamp (covers "Data recorded before a field existed"). Verify: `npm test` passes.

## 6. Entry points and documentation

- [ ] 6.1 Add commands for the summary, timeline and analysis views to `package.json`, alongside the existing `stats:report`, with the timeline taking a task identifier as an argument. Verify: each command runs against a populated database and produces its view.
- [ ] 6.2 Confirm the existing `npm run stats:report` still produces the report it produced before, unchanged in content (covers the two retained "Report generation" scenarios). Verify: `npm test` passes and the command's output is unchanged.
- [ ] 6.3 Document the three views in `README.md`: what question each answers, how to run it, and how to read "unavailable" where it appears. Verify: README describes all three.

## 7. Final verification

- [ ] 7.1 Run `npm test` and `npx tsc --noEmit`; both must pass with no new failures. Verify: `npm test` exits 0 and `tsc` reports no errors.
- [ ] 7.2 Run all three views against a real database produced by the running bot and confirm the figures are plausible and internally consistent — in particular that the summary's token total matches the sum of the per-task totals, and that no view reports a figure the instrumentation never recorded. Verify: the views agree with each other and with the underlying rows.
