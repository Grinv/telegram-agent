## Context

See proposal.md — Why. What exists to build on:

- `runLoop` and `createMessageHandler` are separable (`src/orchestrator.ts`): the loop can be driven without a Telegram client, and `OrchestratorDeps.client` is the narrow `TelegramReplier` interface, which a benchmark can satisfy with a collector.
- `StatsRecorder` is injectable and `statsDbPath` is configurable, so a run can be pointed at its own database.
- `deps.model` pins a model, and `deps.router` is optional — omitting it disables routing.
- The Ollama connector sends `model`, `messages`, `stream`, and optionally `tools` and `think`. It sends no `options`, so temperature and seed are whatever the provider defaults to.

## Goals / Non-Goals

**Goals:**
- Make the optimization change's two claims checkable: tokens fell, correctness did not.
- Keep the measurement honest under a non-deterministic system.
- Keep benchmark traffic out of real usage statistics.

**Non-Goals:**
- Reusing the benchmark as a test suite. It needs a real model and takes minutes; `npm test` must stay fast and offline.
- Measuring latency as a target. It is recorded, but a local model's speed tracks whatever else the machine is doing.

## Decisions

**Correctness is a mechanical check the task declares, not a model's judgement.** An LLM-as-judge would be easier to write for open-ended answers and would undermine the entire gate: the judge is itself non-deterministic, so a correctness change could come from the judge drifting rather than the agent regressing. Tasks are therefore written to have checkable answers — the reply contains a computed value, names a specific file, reports a number the runner can verify independently. This constrains what the task set can ask, which is the price of a gate that means something.

**Drive the agent through its own handler, not through a reimplementation.** The runner supplies a fake replier that captures the outgoing text and calls the real message handler. Anything less — calling `runLoop` directly, say — would measure a path the user never takes and would silently skip routing, history and delivery. The fake replier also makes the reply available for the correctness check, which is exactly what it needs.

**Repeat each task, and report correctness over repetitions.** Even with a fixed seed, a tool-using loop can diverge: a tool's output changes, the model picks a different tool, the turn count shifts. One run per task would make correctness a coin flip dressed as a measurement. Repetitions cost time and buy the ability to distinguish "this regressed" from "this is noisy" — a task that is already flaky before an optimization must be visible as flaky, or it will be blamed on the optimization afterwards.

**Pin the model and disable routing.** Routing exists to pick different models for different messages, which is the opposite of what a controlled measurement wants. With routing on, a change in classification between two runs would move tokens without anything about the agent having changed.

**Ask for deterministic sampling, and do not pretend it is guaranteed.** The connector gains optional sampling controls so the benchmark can request greedy decoding with a fixed seed. This narrows variance; it does not eliminate it, which is why repetitions exist regardless. The controls are optional and default to absent, so ordinary operation is untouched.

**Snapshots record their conditions, and the comparison refuses mismatches.** A snapshot names its model and identifies its task set. Comparing across a change to either is meaningless, and the failure mode is not an error — it is a plausible-looking number that misattributes a task-set edit to an optimization. Refusing is the only safe behaviour.

This is also why the task set is frozen after the first baseline. That rule cannot be enforced by code that only sees one snapshot at a time, so the comparison enforces it after the fact by identifying the set, and the documentation states it plainly.

**Benchmark runs write to their own database.** Otherwise a baseline run would inject hundreds of synthetic tasks into the statistics that describe real usage, permanently distorting the very averages the dashboard reports.

## Risks / Trade-offs

**Checkable tasks are not representative tasks** → Requiring a mechanical check biases the set toward questions with verifiable answers, while real usage is more open-ended. The token profile is what is being measured, so the set is chosen to span the ways tokens are spent — no tools, tools, skills, sub-agents, multi-turn — even where individual questions are more artificial than a real conversation. Worth restating when reading the results: this measures cost on a representative *spread of shapes*, not on a representative sample of user messages.

**A flaky task poisons the gate** → A task that passes intermittently will look like a regression roughly at random. Establish each task's stability while building the baseline: a task that does not answer consistently across repetitions before any optimization should be fixed or removed then, not after it has muddied a comparison.

**The benchmark is slow and needs a real model** → It cannot run in CI and will not be run often. That is acceptable for something executed at two points in the work, but it means it will rot silently if the agent changes underneath it. Running it once between the baseline and the optimization work is a cheap guard against that.

**A local provider's cost figures are proxies** → Estimated cost derives from a price table that, for a local model, holds the rates of comparable hosted models. The proportional change between two snapshots is meaningful; the absolute figures are not spend.
