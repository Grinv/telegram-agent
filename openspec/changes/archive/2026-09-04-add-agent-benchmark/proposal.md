## Why

The optimization work that follows has to prove two things: that token consumption fell by a worthwhile margin, and that the agent did not get worse in the process. Neither is provable today. There is no repeatable way to run the agent over a known set of tasks, no record of what it cost on those tasks before a change, and no definition of whether an answer was correct — the statistics record whether a run *failed*, which is not the same thing as whether it was *right*.

That distinction is the whole point. An optimization that truncates tool output aggressively will keep completing runs while quietly producing worse answers. Measured as "did not error", it looks free. The quality gate has to be able to catch it.

Nothing about this change makes the agent better. It makes the next change's claims checkable.

## What Changes

- A fixed set of benchmark tasks, each stating the message to send and how to decide whether the reply was correct.
- A runner that executes the whole set against the real agent and records every run's tokens, cost, turns, tool calls and correctness.
- Runs are made as repeatable as the provider allows: a pinned model, deterministic sampling settings, routing disabled, and a fresh conversation per task so no run inherits another's history.
- Each task is run several times, because a single run of a non-deterministic system is an anecdote; correctness is reported over all runs.
- Results are saved as a labelled snapshot, and any two snapshots can be compared to show the change in tokens, cost and correctness.
- Benchmark runs write to their own database, so measurement traffic never mixes into the statistics of real usage.

## Capabilities

### New Capabilities

- `agent-benchmark`: the fixed task set, the definition of a correct outcome, the repeatable run, the labelled snapshot, and the comparison between two snapshots.

### Modified Capabilities

- `llm-inference`: the inference request gains optional sampling controls, so a benchmark run can ask for deterministic generation instead of the provider's defaults.

## Impact

- New `benchmark/` directory holding the task set. Once a baseline snapshot has been taken, the task set is frozen: editing it invalidates every snapshot taken before the edit, and comparisons across that edit are meaningless.
- New runner and comparison entry points, with scripts in `package.json`.
- `src/llm/types.ts` and `src/llms/ollama/index.ts` — optional sampling controls passed through to the provider. The stub connector ignores them.
- Snapshots written under `data/` (gitignored), like the statistics database.
- `README.md` — how to run a benchmark, what a snapshot contains, and the rule about not editing the task set.
- **Sequencing**: land after `extend-observability-instrumentation` and `add-observability-dashboard`, and after every phase-one change. A baseline is only worth taking once the agent is feature-complete and the instrumentation records everything the comparison needs — a baseline taken before conversation history exists would not measure the largest source of token growth.

## Non-goals

- Judging answer quality with a model. Correctness is decided by a check the task declares, so the gate cannot itself drift.
- Benchmarking latency as a target. Timings are recorded, but a local provider's speed depends on what else the machine is doing.
- Running in CI. The benchmark needs a real provider and real model weights.
