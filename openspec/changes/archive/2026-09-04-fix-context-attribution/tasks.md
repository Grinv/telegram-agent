Sequencing note: land first, ahead of `adopt-standard-observability` and `add-token-optimizations`. Both of those report the content-category and repeated-input figures this change corrects — the observability change exports them, the optimization change justifies its choices by them — so correcting them first means neither ships a known defect and then has to be revisited.

## 1. Attribute tool definitions to their own category

- [x] 1.1 Extend `categorizeInputTokens` in `src/stats/context-categories.ts` to take the call's advertised tool definitions and attribute their estimated size to a tool-definition category, keeping the guarantee that the categories sum exactly to the reported input total. Verify: `npx tsc --noEmit` passes.
- [x] 1.2 Pass the request's tool definitions into `measureContextStats` from `runLoop` in `src/orchestrator.ts`, leaving the computation inside the existing failure-tolerant wrapper so a failure is still logged and omitted rather than failing the message (see design.md — Decisions). Verify: `npx tsc --noEmit` passes.
- [x] 1.3 Test that a call advertising tools records their tokens under the tool-definition category and adds them to no other category (covers "Tool definitions are attributed to themselves"), in `test/stats/context-categories.test.ts`. Verify: `npm test` passes.
- [x] 1.4 Test that all categories together account for the call's whole input with no unattributed remainder when tool definitions are present (covers "Categories account for the input"). Verify: `npm test` passes.
- [x] 1.5 Test that a call advertising no tools attributes nothing to the tool-definition category while the remaining categories still account for the whole input (covers "A call that advertises no tools"). Verify: `npm test` passes.
- [x] 1.6 Test that two turns with byte-identical instructions and byte-identical tool definitions record identical figures for both categories, and only the categories whose content changed differ (covers "An unchanged category does not appear to change" and the existing "Growth of a category is visible across turns"). Verify: `npm test` passes.

## 2. Count the constant block in repeated input

- [x] 2.1 Extend `measureRepeatedInput` in `src/stats/repeated-input.ts` so the tool definitions participate in the repeated/new division, keeping repetition scoped to a single task (see design.md — Decisions). Verify: `npx tsc --noEmit` passes.
- [x] 2.2 Test that a task's second turn advertising the same tool definitions records their tokens as repeated rather than new, and does not omit them (covers "Unchanged tool definitions count as repeated on a later turn"), in `test/stats/repeated-input.test.ts`. Verify: `npm test` passes.
- [x] 2.3 Test that a task's first call still records none of its input as repeated, including the tool definitions (covers "First call of a task"). Verify: `npm test` passes.
- [x] 2.4 Test that a second message's first call records no repeated input, so repetition remains measured within a task (covers "Repetition is measured per task"). Verify: `npm test` passes.
- [x] 2.5 Test that a later turn's repeated portion still covers the resent conversation and counts only genuinely new content as new (covers "Later turn repeats earlier content"). Verify: `npm test` passes.

## 3. Record the new figure and mark the old ones

- [x] 3.1 Add the tool-definition token field to the recorded LLM-call row in `src/stats/types.ts` and `src/stats/sqlite-recorder.ts`. Verify: `npx tsc --noEmit` passes.
- [x] 3.2 Add a versioned migration in `src/stats/migrations.ts` introducing the field and a marker distinguishing rows recorded under the previous attribution. Verify: `npx tsc --noEmit` passes.
- [x] 3.3 Test that the migration applied to a database populated at the previous version preserves every existing row in `messages`, `llm_calls` and `tool_calls`, rather than only testing a freshly created database, in `test/stats/migrations.test.ts`. Verify: `npm test` passes.
- [x] 3.4 Test that a recorded call's tool-definition tokens are written and read back, in `test/stats/sqlite-recorder.test.ts`. Verify: `npm test` passes.

## 4. Views report the new category and refuse to mix attributions

- [x] 4.1 Render the tool-definition category as its own line in the analysis view's category division, distinct from the agent's instructions, in `src/stats/dashboard-views.ts` and `src/stats/dashboard-queries.ts`. Verify: `npx tsc --noEmit` passes.
- [x] 4.2 Exclude rows recorded under the previous attribution from category and repeated-input aggregates, or mark those aggregates as partial. Verify: `npx tsc --noEmit` passes.
- [x] 4.3 Test that the analysis view shows the tool-definition category as its own line with its own share (covers "The constant portion of a request is visible"), in `test/stats/dashboard-queries.test.ts`. Verify: `npm test` passes.
- [x] 4.4 Test that an aggregate spanning rows from both attributions is reported as partial or excludes the old rows, rather than combining them into one figure (covers "Rows recorded under the previous attribution"). Verify: `npm test` passes.
- [x] 4.5 State in the analysis view's own output that repeated input and the category division are measured over the whole request including tool definitions, so a reader comparing against an earlier report sees a corrected measurement rather than a change in the agent's behaviour (see design.md — Risks). Verify: the view's output carries the statement.

## 5. Prove the benchmark is unaffected

- [x] 5.1 Run the benchmark and compare against the existing baseline snapshot, confirming per-task tokens, cost, turns, tool calls and correctness are identical (see design.md — Risks). Verify: the comparison reports no difference.
- [x] 5.2 Confirm `benchmark/` is unmodified by this change, so the frozen task set and its baseline stay valid. Verify: `git diff` over `benchmark/` shows no change.

## 6. Re-read the baseline with corrected measurements

- [x] 6.1 Regenerate the analysis view over the baseline stats database and record the corrected figures — the category division including tool definitions, and the corrected repeated-input proportion — alongside the figures the previous attribution reported, so the size of the correction is on record. Verify: both sets of figures are written down.

## 7. Documentation

- [x] 7.1 Document the tool-definition category and what it covers wherever the existing categories are described in `README.md`. Verify: the category and its meaning are documented.

## 8. Final verification

- [x] 8.1 Run `npm test` and `npm run typecheck`; both must pass with no new failures. Verify: `npm test` exits 0 and the type check reports no errors.
