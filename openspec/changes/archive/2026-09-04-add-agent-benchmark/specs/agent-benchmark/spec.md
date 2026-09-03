## Purpose

Provides a repeatable measurement of what the agent costs and whether it answers correctly over a fixed set of tasks, so that a change intended to reduce token consumption can be shown to have done so without degrading the agent's answers.

## ADDED Requirements

### Requirement: The benchmark task set is fixed and declares correctness
The system SHALL define a set of benchmark tasks. Each task SHALL state the message to send to the agent and a check that decides whether a reply to it was correct. The check SHALL be evaluated mechanically and SHALL NOT depend on a language model, so that the measure of correctness cannot itself drift between runs.

The task set SHALL cover the agent's capabilities that consume tokens differently, including at minimum: a reply requiring no tools, a reply requiring command execution, a reply requiring reading a file, a task exercising a skill, a task decomposed across sub-agents, and a multi-turn exchange that relies on conversation history.

#### Scenario: A task declares its own correctness check
- **WHEN** a benchmark task is defined
- **THEN** it carries both the message to send and a check that, given a reply, decides whether that reply was correct

#### Scenario: Correctness does not depend on a model
- **WHEN** a task's correctness check is evaluated twice on the same reply
- **THEN** it returns the same verdict both times

#### Scenario: The set covers differing token profiles
- **WHEN** the task set is inspected
- **THEN** it contains tasks that use no tools, tasks that use tools, a task using a skill, a task using sub-agents, and a multi-turn task

### Requirement: A benchmark run is repeatable
The system SHALL execute the task set against the real agent with the conditions that affect token consumption held fixed: a single pinned model with routing disabled, deterministic sampling settings requested from the provider, and a conversation history that starts empty for every task so no task inherits another's context.

Each task SHALL be run a configurable number of times within a single benchmark run, so that correctness is measured over repetitions rather than over a single sample.

#### Scenario: Routing does not vary the model
- **WHEN** a benchmark run executes with several models available to the deployment
- **THEN** every task is handled by the pinned model, and no routing decision selects a different one

#### Scenario: Tasks do not inherit each other's history
- **WHEN** a benchmark run executes several tasks in sequence
- **THEN** each task begins with empty conversation history, and no task's request contains a prior task's turns

#### Scenario: Repetitions are executed
- **WHEN** a benchmark run is configured to repeat each task three times
- **THEN** every task is executed three times and all three outcomes are recorded

### Requirement: A benchmark run produces a labelled snapshot
The system SHALL record, for every execution of every task, the tokens consumed, the estimated cost, the number of turns, the number of tool calls, and the correctness verdict — and SHALL save the whole run as a snapshot under a caller-supplied label.

A snapshot SHALL record the conditions it was produced under, including the model used and the identity of the task set, so that a snapshot produced under different conditions can be recognised as not comparable.

#### Scenario: Snapshot records per-task outcomes
- **WHEN** a benchmark run completes
- **THEN** a snapshot is saved under the supplied label containing, for each execution, its token counts, cost, turns, tool calls and correctness verdict

#### Scenario: Snapshot records its conditions
- **WHEN** a snapshot is inspected
- **THEN** it states the model used and identifies the task set it was produced from

### Requirement: Benchmark activity is kept out of real usage statistics
The system SHALL record benchmark activity separately from the statistics of real usage, so that measurement traffic does not alter the figures reported for the agent's actual operation.

#### Scenario: Real statistics are unaffected
- **WHEN** a benchmark run executes against a deployment that also has a statistics database for real usage
- **THEN** the real usage statistics contain no rows from the benchmark run

### Requirement: Two snapshots can be compared
The system SHALL compare two snapshots and report, for the task set as a whole and per task, the change in tokens, the change in estimated cost, and the change in correctness rate — stating each as a direction and magnitude rather than leaving the reader to subtract.

When the two snapshots were produced under conditions that make them incomparable — a different model, or a different task set — the comparison SHALL say so rather than presenting differences as though they were the effect of a change.

#### Scenario: Comparison reports the change
- **WHEN** two snapshots taken over the same task set and model are compared
- **THEN** the comparison reports the change in tokens, cost and correctness rate, overall and per task

#### Scenario: Incomparable snapshots are refused
- **WHEN** two snapshots produced from different task sets, or with different models, are compared
- **THEN** the comparison reports that they are not comparable instead of presenting their differences as a result

#### Scenario: A correctness regression is visible per task
- **WHEN** an optimization causes one task to start answering incorrectly while the others are unaffected
- **THEN** the comparison identifies that task as having regressed, rather than only reporting a small change in the overall rate
