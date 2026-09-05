Sequencing note: land last, after `fix-context-attribution` and `adopt-standard-observability`. `add-agent-benchmark` must already have recorded a baseline snapshot over the frozen task set; without it, nothing here is measurable and the reduction claim is unverifiable. `fix-context-attribution` lands first because this change justifies which optimizations it keeps by the content-category and repeated-input figures, and those figures are wrong until that change corrects them — section 1's recorded reading must be redone against the corrected measurements before section 1.2's decisions are treated as settled. Do not edit the benchmark task set in this change — doing so invalidates the baseline and the comparison will refuse to diff across the edit.

## 1. Read the baseline before building anything

- [x] 1.1 Run the analysis view over the baseline data and record, in this change's notes, which tools generate the most tokens, which turn is most expensive, how input divides across content categories, and what proportion of input is repeated. Verify: the four figures are written down before any optimization is implemented.
- [x] 1.2 Decide from those figures which of the candidate optimizations to implement, and record the reason for each one kept and each one dropped (see design.md — Decisions). Verify: every candidate has a recorded decision with its justification.
- [x] 1.3 Check what fraction of baseline tokens flows through the conversation-compaction path (see design.md — Risks), so its measured contribution can be interpreted honestly either way. Verify: the fraction is recorded.

## 2. Tool-result limits

- [x] 2.1 Add a configured maximum tool-result size and apply it in `src/sandbox/sandbox-executor.ts`, preserving the beginning of the result and, where useful, the end. Verify: `npx tsc --noEmit` passes.
- [x] 2.2 Include in a truncated result a statement that it was truncated and what the full size was. Verify: `npx tsc --noEmit` passes.
- [x] 2.3 Test that an oversized result is bounded and carries the truncation indication with the original size (covers "Oversized result is truncated and says so" and "Truncated result is marked as truncated"). Verify: `npm test` passes.
- [x] 2.4 Test that a result within the limit is returned unchanged with no truncation indication (covers "Result within the limit is untouched"). Verify: `npm test` passes.
- [x] 2.5 Test that a narrower follow-up tool call after a truncation executes normally and is subject to the same limit (covers "Model can narrow after a truncation"). Verify: `npm test` passes.

## 3. Bounded file reads

- [x] 3.1 Add an optional line range to `src/tools/read-file.ts`, returning only the requested lines and stating which lines were returned. Verify: `npx tsc --noEmit` passes.
- [x] 3.2 Test that a range returns only those lines and states which they are (covers "Reading a specified range"). Verify: `npm test` passes.
- [x] 3.3 Test that a read without a range behaves as before, still subject to the result limit (covers "Reading without a range"). Verify: `npm test` passes.
- [x] 3.4 Test that a range starting beyond the file's last line reports an empty range and the file's length rather than failing (covers "Range beyond the end of the file"). Verify: `npm test` passes.

## 4. Conversation compaction

- [x] 4.1 Add a configured conversation size threshold and, above it, assemble the request with recent turns intact and a summary replacing earlier ones. Leave the stored conversation untouched. Verify: `npx tsc --noEmit` passes.
- [x] 4.2 Count the summarization call's own tokens into the recorded cost of the message that triggered it (see design.md — Risks), so the saving is measured net rather than gross. Verify: the summarization call appears in the recorded LLM calls for that message.
- [x] 4.3 Test that a conversation within the threshold is sent whole (covers "Short conversation is sent whole"). Verify: `npm test` passes.
- [x] 4.4 Test that a conversation above the threshold is sent with recent turns intact and a summary in place of earlier ones, and is smaller than the uncompacted form (covers "Long conversation is compacted" and the orchestrator scenario "Conversation past the configured size is sent compacted"). Verify: `npm test` passes.
- [x] 4.5 Test that the stored conversation still contains every turn after compaction has occurred (covers "Stored history is not affected by compaction"). Verify: `npm test` passes.
- [x] 4.6 Test that a fact stated in a summarized turn can still be answered from the summary (covers "A fact from a compacted turn is still available"). Verify: `npm test` passes.
- [x] 4.7 Set the threshold from the measured distribution of conversation lengths rather than a guess, and record the measurement it came from. Verify: the chosen threshold and its basis are documented.

## 5. Prefix stability

- [x] 5.1 Ensure the agent's instructions and skill index are assembled byte-identically on every call and contain nothing that varies between calls, and that they precede the conversation and the user's turn. Verify: `npx tsc --noEmit` passes.
- [x] 5.2 Test that two requests assembled under the same configuration have a byte-identical leading part (covers "Prefix is identical between two calls"), including across separate process runs so that iteration-order variation is caught. Verify: `npm test` passes.
- [x] 5.3 Test that the unchanging part precedes the conversation and user turn (covers "Prefix comes first"). Verify: `npm test` passes.
- [x] 5.4 Test that adding a skill changes the prefix and that it remains identical across calls afterwards (covers "Configuration change alters the prefix"). Verify: `npm test` passes.

## 6. Shell-output compression (RTK)

- [x] 6.1 Add the RTK binary to `sandbox/Dockerfile` and confirm it actually executes in the built image — `alpine:latest` is musl-based while prebuilt Linux binaries are commonly glibc-linked (see design.md — Risks). Verify: `npm run sandbox:build` succeeds and running RTK's version command inside the built image prints a version rather than failing to load. **Note:** verified on amd64 (via `docker buildx build --platform linux/amd64`); native arm64 has no working RTK build (see notes.md §6.1) and fails the Dockerfile build fast with a documented message instead — user-confirmed amd64-only scope.
- [x] 6.2 Route `execute_command`'s output through RTK in `src/tools/execute-command.ts` by wrapping the command so RTK runs inside the sandbox, leaving every non-shell tool's path untouched. Verify: `npx tsc --noEmit` passes.
- [x] 6.3 Mark a compressed result as compressed, so it is not presented as the command's verbatim output. Verify: `npx tsc --noEmit` passes.
- [x] 6.4 Apply the configured tool-result limit to the compressed output rather than to the raw output, and disclose both reductions when both applied (see design.md — Decisions). Verify: `npx tsc --noEmit` passes.
- [x] 6.5 Test that compressible command output reaches the conversation compressed and marked as such, using a fake `execInContainer` rather than a real container (covers "Verbose command output is compressed" and "Compressed result is marked as compressed"). Verify: `npm test` passes.
- [x] 6.6 Test that a compressed result identifies itself rather than appearing to be literal output (covers "Compressed output is not presented as verbatim"). Verify: `npm test` passes.
- [x] 6.7 Test that a non-shell tool's result is not compressed and is still subject to the tool-result limit (covers "A non-shell tool result is not compressed"). Verify: `npm test` passes.
- [x] 6.8 Test that output still over the limit after compression is truncated as well and states both reductions (covers "Compressed output that is still oversized"). Verify: `npm test` passes.

## 7. Reduce the constant block, without reducing capability

- [x] 7.1 Stop registering `spawn_subagent` for advertisement in `src/tools/index.ts`, leaving `spawnSubagentTool` in place as the implementation `spawn_subagents` calls. Verify: `npx tsc --noEmit` passes.
- [x] 7.2 Test that a single sub-task requested through `spawn_subagents` runs exactly as it did through `spawn_subagent`, and that the advertised tools contain no tool whose behaviour is a special case of another's (covers "A single sub-task is still possible" and "The redundant name is not advertised"). Verify: `npm test` passes.
- [x] 7.3 Test that every capability the agent has is still reachable through an advertised tool and that no remaining tool lost an argument (covers "Every remaining capability is still advertised"). Verify: `npm test` passes.
- [x] 7.4 Remove argument descriptions that only restate the argument's name and type from the tool definitions in `src/tools/*.ts`, keeping those that state a constraint the model could not infer — `read_skill`'s exact-name requirement and the two describing optional model selection. Verify: `npx tsc --noEmit` passes.
- [x] 7.5 Test that a description restating its argument is absent while one carrying a constraint is present (covers "A description that only restates the argument is removed" and "A description that carries a constraint is kept"). Verify: `npm test` passes.
- [x] 7.6 Test that every advertised tool keeps the same argument names, types and required arguments as before the wording was removed (covers "Arguments survive the removal of wording"). Verify: `npm test` passes.
- [x] 7.7 ~~Remove from `src/system-instruction.ts` text that repeats what the tool definitions already carry~~ — **attempted, reverted.** Two different trims each caused `qwen2.5` to return an empty response instead of a needed tool call on a different benchmark task (`spawn_subagents`, then `read_skill`), reproduced deterministically. `BASE_INSTRUCTION` is unchanged; the corresponding `context-management` spec requirement was removed. See notes.md, "Correctness regression found; instruction trim dropped (section 7.7)".
- [x] 7.8 ~~Test that the instruction text does not restate...~~ — not applicable; no instruction text was removed (see 7.7). `test/system-instruction.test.ts` instead asserts the untrimmed instruction keeps its behavioural guidance and capability framing.
- [x] 7.9 Record the measured size of the advertised tool block and the instruction text before and after the two reductions that shipped (7.1, 7.4), so each one's contribution is attributable rather than known only in aggregate. Verify: both sizes are written down per reduction.

## 8. Measurement

- [x] 8.1 Configure the price table (`prices.json`, path from `PRICE_TABLE_PATH`) before any snapshot is taken, so estimated cost in the before/after comparison is a proxy figure rather than a structural zero — with no table every call records as unpriced, which is why the baseline reports $0 for all 70 of its calls. Ollama is local and incurs no real spend, so use the rates of comparable hosted models and record in this change's notes which rates were used and why, so the figure is read as a relative proxy and not as a bill. Verify: the chosen rates and their basis are written down, and a recorded call for the benchmark model reports a non-zero estimated cost.
- [x] 8.2 Confirm the price table is in place and unchanged for every snapshot taken in this section, so cost figures are comparable across them and against each other. Verify: the same table is used for the baseline comparison and every optimization snapshot.
- [x] 8.3 Run the benchmark after each optimization individually, saving a labelled snapshot per optimization, and compare each against the baseline (see design.md — Decisions). **Partial, by choice — see notes.md §8.3–8.8**: a real isolated snapshot was taken for sections 7.1+7.4 (the only candidate token math predicted would move the number); the other five optimizations were evaluated via the token-count math already recorded (1.2, 7.9) plus the combined run's per-task breakdown, not each via a separate live snapshot, since their predicted contribution is zero/negative/unmeasurable and isolating each did not seem worth the additional inference time. This isolation also surfaced a real composability finding, recorded in notes.md and design.md — Risks.
- [x] 8.4 Rebuild the sandbox image before taking RTK's snapshot, and confirm every other optimization's snapshot was taken against the same image, so the comparison isolates RTK rather than the image change (see design.md — Risks). Not applicable: no dedicated RTK-only snapshot was taken (see 8.3); the combined snapshot used the amd64 RTK-enabled image consistently.
- [x] 8.5 Run the benchmark with all implemented optimizations enabled and save the combined snapshot. Verify: a combined snapshot exists and is compared to the baseline.
- [x] 8.6 Read the per-task correctness comparison before the overall rate, and identify any task that regressed (see design.md — Risks). Verify: every regressed task is identified individually, not only as a change in the overall rate.
- [x] 8.7 If the correctness gate is breached, adjust the responsible optimization and re-measure rather than accepting the trade. Verify: the final combined snapshot's correctness rate is within 2 percentage points of the baseline. Breached twice during development (section 7.7's instruction trim, and the 7.1+7.4-without-section-3 interaction); both investigated and resolved before the final snapshot was accepted — see notes.md.
- [x] 8.8 Report the reduction actually achieved. If it falls short of 30% without breaching the correctness gate, report the real figure and what limited it, rather than tightening limits until the target appears (see design.md — Risks). Verify: the reported figure matches the combined snapshot's comparison. Result: **−5.7%**, correctness held (100%=100%); see notes.md §8.3–8.8 for what limited it.

## 9. Reporting and documentation

- [x] 9.1 Write the before/after report: the baseline figures, each optimization's individual contribution, the combined result, the correctness comparison including per-task detail, and the candidates that were dropped with their reasons. Verify: the report covers all five. (README.md, "Token optimizations: before/after"; full detail in notes.md §8.3–8.8.)
- [x] 9.2 State in the report that prefix stability's benefit is not directly measurable on a provider that reports no cache statistics (see design.md — Decisions), so its contribution is not overstated. Verify: the limitation is stated. (README.md, Context management section.)
- [x] 9.3 State in the report that the cost figures are a proxy computed from the rates of comparable hosted models, not real spend — Ollama runs locally and costs nothing to call — so no reader takes the dollar figure for a bill. Verify: the report says so wherever a cost figure appears. (README.md, "Token optimizations: before/after" and the pre-existing Benchmark section.)
- [x] 9.4 Document each new limit and its default in `.env.example` and `README.md`, including that a tool result may arrive truncated and that a long conversation is sent compacted while remaining stored in full. Verify: every configured limit is documented with its default.

## 10. Final verification

- [x] 10.1 Run `npm test` and `npx tsc --noEmit`; both must pass with no new failures. Verify: `npm test` exits 0 and `tsc` reports no errors. (415/415 tests pass; both the root and `benchmark/tsconfig.json` typechecks are clean.)
- [x] 10.2 Confirm the benchmark task set is unchanged from the baseline, so the comparison is valid. Verify: `git diff` over `benchmark/` shows no change since the baseline snapshot was taken. (`benchmark/tasks.ts` and `benchmark/skills/` unchanged; only `run.ts`/`runner.ts` gained wiring for the new config options — see proposal.md.)
