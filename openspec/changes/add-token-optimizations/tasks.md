Sequencing note: land last. `add-agent-benchmark` must already have recorded a baseline snapshot over the frozen task set; without it, nothing here is measurable and the reduction claim is unverifiable. Do not edit the benchmark task set in this change — doing so invalidates the baseline and the comparison will refuse to diff across the edit.

## 1. Read the baseline before building anything

- [ ] 1.1 Run the analysis view over the baseline data and record, in this change's notes, which tools generate the most tokens, which turn is most expensive, how input divides across content categories, and what proportion of input is repeated. Verify: the four figures are written down before any optimization is implemented.
- [ ] 1.2 Decide from those figures which of the four candidate optimizations to implement, and record the reason for each one kept and each one dropped (see design.md — Decisions). Verify: every candidate has a recorded decision with its justification.
- [ ] 1.3 Check what fraction of baseline tokens flows through the conversation-compaction path (see design.md — Risks), so its measured contribution can be interpreted honestly either way. Verify: the fraction is recorded.

## 2. Tool-result limits

- [ ] 2.1 Add a configured maximum tool-result size and apply it in `src/sandbox/sandbox-executor.ts`, preserving the beginning of the result and, where useful, the end. Verify: `npx tsc --noEmit` passes.
- [ ] 2.2 Include in a truncated result a statement that it was truncated and what the full size was. Verify: `npx tsc --noEmit` passes.
- [ ] 2.3 Test that an oversized result is bounded and carries the truncation indication with the original size (covers "Oversized result is truncated and says so" and "Truncated result is marked as truncated"). Verify: `npm test` passes.
- [ ] 2.4 Test that a result within the limit is returned unchanged with no truncation indication (covers "Result within the limit is untouched"). Verify: `npm test` passes.
- [ ] 2.5 Test that a narrower follow-up tool call after a truncation executes normally and is subject to the same limit (covers "Model can narrow after a truncation"). Verify: `npm test` passes.

## 3. Bounded file reads

- [ ] 3.1 Add an optional line range to `src/tools/read-file.ts`, returning only the requested lines and stating which lines were returned. Verify: `npx tsc --noEmit` passes.
- [ ] 3.2 Test that a range returns only those lines and states which they are (covers "Reading a specified range"). Verify: `npm test` passes.
- [ ] 3.3 Test that a read without a range behaves as before, still subject to the result limit (covers "Reading without a range"). Verify: `npm test` passes.
- [ ] 3.4 Test that a range starting beyond the file's last line reports an empty range and the file's length rather than failing (covers "Range beyond the end of the file"). Verify: `npm test` passes.

## 4. Conversation compaction

- [ ] 4.1 Add a configured conversation size threshold and, above it, assemble the request with recent turns intact and a summary replacing earlier ones. Leave the stored conversation untouched. Verify: `npx tsc --noEmit` passes.
- [ ] 4.2 Count the summarization call's own tokens into the recorded cost of the message that triggered it (see design.md — Risks), so the saving is measured net rather than gross. Verify: the summarization call appears in the recorded LLM calls for that message.
- [ ] 4.3 Test that a conversation within the threshold is sent whole (covers "Short conversation is sent whole"). Verify: `npm test` passes.
- [ ] 4.4 Test that a conversation above the threshold is sent with recent turns intact and a summary in place of earlier ones, and is smaller than the uncompacted form (covers "Long conversation is compacted" and the orchestrator scenario "Conversation past the configured size is sent compacted"). Verify: `npm test` passes.
- [ ] 4.5 Test that the stored conversation still contains every turn after compaction has occurred (covers "Stored history is not affected by compaction"). Verify: `npm test` passes.
- [ ] 4.6 Test that a fact stated in a summarized turn can still be answered from the summary (covers "A fact from a compacted turn is still available"). Verify: `npm test` passes.
- [ ] 4.7 Set the threshold from the measured distribution of conversation lengths rather than a guess, and record the measurement it came from. Verify: the chosen threshold and its basis are documented.

## 5. Prefix stability

- [ ] 5.1 Ensure the agent's instructions and skill index are assembled byte-identically on every call and contain nothing that varies between calls, and that they precede the conversation and the user's turn. Verify: `npx tsc --noEmit` passes.
- [ ] 5.2 Test that two requests assembled under the same configuration have a byte-identical leading part (covers "Prefix is identical between two calls"), including across separate process runs so that iteration-order variation is caught. Verify: `npm test` passes.
- [ ] 5.3 Test that the unchanging part precedes the conversation and user turn (covers "Prefix comes first"). Verify: `npm test` passes.
- [ ] 5.4 Test that adding a skill changes the prefix and that it remains identical across calls afterwards (covers "Configuration change alters the prefix"). Verify: `npm test` passes.

## 6. Measurement

- [ ] 6.1 Run the benchmark after each optimization individually, saving a labelled snapshot per optimization, and compare each against the baseline (see design.md — Decisions). Verify: one snapshot exists per implemented optimization, each compared to the baseline.
- [ ] 6.2 Run the benchmark with all implemented optimizations enabled and save the combined snapshot. Verify: a combined snapshot exists and is compared to the baseline.
- [ ] 6.3 Read the per-task correctness comparison before the overall rate, and identify any task that regressed (see design.md — Risks). Verify: every regressed task is identified individually, not only as a change in the overall rate.
- [ ] 6.4 If the correctness gate is breached, adjust the responsible optimization and re-measure rather than accepting the trade. Verify: the final combined snapshot's correctness rate is within 2 percentage points of the baseline.
- [ ] 6.5 Report the reduction actually achieved. If it falls short of 30% without breaching the correctness gate, report the real figure and what limited it, rather than tightening limits until the target appears (see design.md — Risks). Verify: the reported figure matches the combined snapshot's comparison.

## 7. Reporting and documentation

- [ ] 7.1 Write the before/after report: the baseline figures, each optimization's individual contribution, the combined result, the correctness comparison including per-task detail, and the candidates that were dropped with their reasons. Verify: the report covers all five.
- [ ] 7.2 State in the report that prefix stability's benefit is not directly measurable on a provider that reports no cache statistics (see design.md — Decisions), so its contribution is not overstated. Verify: the limitation is stated.
- [ ] 7.3 Document each new limit and its default in `.env.example` and `README.md`, including that a tool result may arrive truncated and that a long conversation is sent compacted while remaining stored in full. Verify: every configured limit is documented with its default.

## 8. Final verification

- [ ] 8.1 Run `npm test` and `npx tsc --noEmit`; both must pass with no new failures. Verify: `npm test` exits 0 and `tsc` reports no errors.
- [ ] 8.2 Confirm the benchmark task set is unchanged from the baseline, so the comparison is valid. Verify: `git diff` over `benchmark/` shows no change since the baseline snapshot was taken.
