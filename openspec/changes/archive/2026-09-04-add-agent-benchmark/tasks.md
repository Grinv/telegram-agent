Sequencing note: land after every phase-one change and after `extend-observability-instrumentation` and `add-observability-dashboard`. The baseline snapshot this produces is only meaningful once the agent is feature-complete — a baseline taken before conversation history exists would miss the largest source of token growth — and the snapshot's token, cost and turn figures come from columns the instrumentation change adds.

## 1. Sampling controls

- [x] 1.1 Add optional sampling controls to `LlmRequest` in `src/llm/types.ts`, absent by default. Verify: `npx tsc --noEmit` passes.
- [x] 1.2 Pass them through in `src/llms/ollama/index.ts` when present, leaving the request body unchanged when absent. Verify: `npx tsc --noEmit` passes.
- [x] 1.3 Test in `test/llms/ollama.test.ts` with a fake `fetch` that supplied controls reach the provider (covers "Request specifies deterministic sampling"), and that a request without them produces a body identical to today's (covers "Request specifies no sampling controls"). Verify: `npm test` passes.
- [x] 1.4 Test in `test/llms/stub.test.ts` that the stub returns a result for a request carrying sampling controls rather than failing (covers "Connector without sampling support"). Verify: `npm test` passes.

## 2. Task set

- [x] 2.1 Create `benchmark/` with a task definition format carrying the message to send and a mechanical correctness check, and document that the set is frozen once a baseline exists. Verify: `npx tsc --noEmit` passes.
- [x] 2.2 Write the tasks, covering at minimum: no tools, command execution, file reading, a skill, sub-agent decomposition, and a multi-turn exchange relying on history (covers "The set covers differing token profiles"). Verify: the set contains at least one task of each kind.
- [x] 2.3 Unit-test the correctness checks in isolation against sample replies, including that a check returns the same verdict on repeated evaluation of the same reply (covers "A task declares its own correctness check" and "Correctness does not depend on a model"). Verify: `npm test` passes.

## 3. Runner

- [x] 3.1 Implement the runner: for each task, drive the real message handler with a fake replier that captures the reply, with the model pinned, routing disabled, sampling controls set for reproducibility, and a fresh empty conversation history. Verify: `npx tsc --noEmit` passes.
- [x] 3.2 Point the runner's stats recording at its own database, separate from the one real usage writes to. Verify: `npx tsc --noEmit` passes.
- [x] 3.3 Make the repetition count configurable and execute each task that many times per run. Verify: `npx tsc --noEmit` passes.
- [x] 3.4 Test with a fake `callLlm` that a run over several tasks starts each with empty history and that no task's request contains a prior task's turns (covers "Tasks do not inherit each other's history"). Verify: `npm test` passes.
- [x] 3.5 Test with a fake router that would return a different model that the pinned model is used for every task (covers "Routing does not vary the model"). Verify: `npm test` passes.
- [x] 3.6 Test that configuring three repetitions executes each task three times and records all three outcomes (covers "Repetitions are executed"). Verify: `npm test` passes.
- [x] 3.7 Test that a run leaves the real usage statistics database untouched (covers "Real statistics are unaffected"). Verify: `npm test` passes.

## 4. Snapshots

- [x] 4.1 Save a completed run as a labelled snapshot under `data/`, recording per execution the token counts, estimated cost, turns, tool calls and correctness verdict. Verify: `npx tsc --noEmit` passes.
- [x] 4.2 Record the run's conditions in the snapshot — the model used and an identifier for the task set that changes when the set changes. Verify: `npx tsc --noEmit` passes.
- [x] 4.3 Test that a snapshot contains an entry per execution with all recorded figures (covers "Snapshot records per-task outcomes") and states its conditions (covers "Snapshot records its conditions"). Verify: `npm test` passes.
- [x] 4.4 Confirm snapshots are covered by the existing `data/` gitignore entry. Verify: `git status` shows no snapshot file as untracked after a run.

## 5. Comparison

- [x] 5.1 Implement the comparison of two snapshots, reporting the change in tokens, cost and correctness rate, overall and per task, each as a direction and magnitude. Verify: `npx tsc --noEmit` passes.
- [x] 5.2 Test it over two fixture snapshots and assert the reported changes equal those computed from the fixtures by hand (covers "Comparison reports the change"). Verify: `npm test` passes.
- [x] 5.3 Test that snapshots differing in model, or in task-set identity, are reported as not comparable rather than diffed (covers "Incomparable snapshots are refused"). Verify: `npm test` passes.
- [x] 5.4 Test that a fixture in which exactly one task's correctness drops identifies that task as regressed, not merely a small overall change (covers "A correctness regression is visible per task"). Verify: `npm test` passes.

## 6. Baseline

- [x] 6.1 Add `package.json` scripts for running a benchmark and comparing two snapshots. Verify: both run against a real provider.
- [x] 6.2 Establish each task's stability before recording the baseline: run the set with repetitions and identify any task whose correctness varies while nothing has changed. Fix or remove such tasks now (see design.md — Risks), because a task that is already flaky will be blamed on a later optimization. Verify: every task in the frozen set answers consistently across repetitions.
- [x] 6.3 Record the baseline snapshot from the stabilised set and keep it as the reference for the optimization work. Verify: a labelled baseline snapshot exists and its correctness rate is recorded.
- [x] 6.4 Freeze the task set: note in `benchmark/` and `README.md` that editing it invalidates the baseline, and that the comparison will refuse to diff across such an edit. Verify: the rule is documented in both places.

## 7. Documentation and final verification

- [x] 7.1 Document in `README.md` how to run the benchmark, what a snapshot contains, how to compare two, why cost figures are proxies for a local provider, and the frozen-set rule. Verify: README covers all five points.
- [x] 7.2 Run `npm test` and `npx tsc --noEmit`; both must pass with no new failures, and the test suite must remain fast and offline — the benchmark itself must not run as part of it. Verify: `npm test` exits 0 without contacting a provider.
