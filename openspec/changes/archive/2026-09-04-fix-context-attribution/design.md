## Context

See proposal.md — Why for the defect and the measurements that establish it.

Three facts about the current code shape the approach.

`categorizeInputTokens` and `measureRepeatedInput` are pure functions over `ChatMessage[]`. They are called from one place, `measureContextStats` in `src/orchestrator.ts`, which is itself wrapped so that a failure in either is logged and omitted rather than failing the message. That wrapper is the reason this change can be made without risk to message handling, and it must be preserved.

The tool definitions are already in scope at the call site. `runLoop` builds `request.tools` from `tools` — the parameter it received — and holds it across the whole loop. Passing it into the measurement is an argument, not a plumbing exercise.

The stats database is versioned and migrated (`src/stats/migrations.ts`), and the `agent-stats` capability already requires that migrations preserve existing rows. Rows written before this change cannot be recomputed: the database stores the derived figures, not the message lists and tool definitions they were derived from.

## Goals / Non-Goals

**Goals:**
- The recorded categories account for the whole input the provider charged for, not the part of it that happened to be in the message list.
- A figure computed under the old attribution is never averaged together with one computed under the new.
- The benchmark's token, cost, turn and tool-call figures are provably unchanged.

**Non-Goals:**
- Reducing the tool-definition block. This change measures it; shrinking it is a separate question.
- Recomputing historical rows.
- Making the estimate more accurate in absolute terms. `estimateTokens` remains a ~4-characters-per-token approximation applied consistently; this change is about what it is applied to, not how it counts.

## Decisions

**Tool definitions get their own category rather than joining the instructions.** The alternative — folding them into the instruction category — is less code and less schema change, and it was rejected because it would hide the number that matters. Measured on the baseline, the instruction text is ~60 estimated tokens and the tool definitions ~542. Merging them reports 602 and makes the ninefold difference invisible, at exactly the moment someone is reading the view to decide what to shorten. The two are also changed by different means: the instruction is authored text edited by hand, the definitions are generated from whatever tools are registered. A category that cannot distinguish them cannot guide either decision.

**The categories are computed from actual sizes, with the provider's total apportioned across them — the existing mechanism, extended rather than replaced.** The provider reports one number for the whole input and does not itemise it, so some apportioning is unavoidable. The defect was never the apportioning; it was that one of the parts was left out of the denominator while remaining in the numerator's total. Adding the tool definitions to the estimated-size calculation fixes it within the existing design, and keeps the guarantee that the categories sum exactly to the reported total.

**Repetition stays scoped to a task.** Widening it to the process was considered, because the tool-definition block genuinely was sent during previous tasks and a prefix-caching provider would treat it as reusable. It was rejected because the measurement would then depend on how many tasks the process had already handled: the same benchmark task would report different repetition on the first repetition than on the fifth, and the benchmark compares repetitions of the same task. A measurement that cannot be reproduced across runs is worse than one that understates.

The understatement is bounded and visible: the block counts as new exactly once per task and as repeated on every subsequent call, and its absolute size is reported in its own category regardless. A reader who wants the cross-task figure can compute it from the category, which is why keeping the category separate matters more than widening the repetition scope.

**Old rows are marked, not migrated.** The recorded figures cannot be recomputed — the inputs they were derived from are not stored — so the choice is between marking them and silently mixing them. The `agent-stats` capability already has the pattern for this: its requirement that unavailable figures are reported as unavailable already covers rows recorded before a field existed. This change follows the same route: a schema migration adds the new field and a marker for the attribution version, and the views exclude or flag pre-change rows rather than averaging two different measurements into one number.

**The measurement stays in the failure-tolerant wrapper.** `measureContextStats` already catches and logs a failure in either computation and omits that call's fields rather than failing the message. Adding a parameter must not move the computation out of that wrapper. This is stated because it is the kind of guarantee that is easy to lose while refactoring a signature, and its loss would turn an observability bug into a message-handling failure.

## Risks / Trade-offs

**Changing what is recorded could change what the benchmark reads** → `benchmark/runner.ts` reads tokens, cost, turns and tool calls, none of which this change touches. That is the expectation, not the verification: the check is to run the benchmark and compare against the existing baseline snapshot, confirming the figures are identical before the change is accepted.

**A new column plus a marker is schema churn on a database that must not lose data** → The existing migration mechanism already covers this and is required to preserve rows. The migration is exercised on a database populated at the old version, not only on a fresh one, because a fresh-database test would pass whether or not existing rows survive.

**The corrected figures will look like a regression** → Repeated input will jump from the reported 31.7% to something far higher, and the instruction share will collapse. Nothing got worse; the earlier numbers were wrong. Whoever reads the views after this change lands needs that stated, or the correction will be mistaken for a change in the agent's behaviour. The analysis view's own output is the right place for it, not just the change's artifacts.

**Attributing tool definitions does not make them smaller** → The view will now show that ~85% of input is a constant block, and that is the whole point; but it is a measurement change, and no token is saved by it. Any claim of saving belongs to a different change.

## Verification

The analysis view was regenerated over `data/benchmark-stats.db` after implementation, once the frozen benchmark task set (`7d533a54`, model `qwen2.5`) had been re-run under the new attribution with `BENCHMARK_REPETITIONS=5` (matching the recorded baseline exactly — see `benchmark/baseline.md`). The re-run reproduced the baseline's own token/cost/turn/tool-call/correctness figures exactly (`npm run benchmark:compare -- baseline after-fix`: tokens Δ +0, cost Δ +0, correctness Δ +0pp, no task regressed), so the two attributions' figures below describe the same 70 LLM calls / 48,845 input tokens, not a different run.

**Content-category division** (share of the 48,845 input tokens):

| Category | Previous attribution (proposal.md — Why) | Corrected attribution |
|---|---|---|
| Instructions | ~88% of a call's ~700 tokens on `capital-of-france` (624 of 707, from the four-category split) | 16.6% (8,090 tokens) |
| Tool definitions | *(not attributed — folded into the figure above)* | **75.4% (36,840 tokens)** |
| User request | ~12% of `capital-of-france` (83 of 707) | 4.1% (2,025 tokens) |
| Conversation | *(counted, not separately reported in the Why section)* | 1.6% (770 tokens) |
| Tool output | *(counted, not separately reported in the Why section)* | 2.3% (1,120 tokens) |

The correction is exactly the one the proposal predicted: tool definitions were the largest single share of input (three-quarters of it) and were previously invisible, spread silently across the other four categories.

**Repeated vs. new input:**

| | Previous attribution | Corrected attribution |
|---|---|---|
| Repeated | 31.7% | 31.2% (14,555 tokens) |
| New | 68.3% | 68.8% (32,040 tokens) |

Unlike the category split, the repeated/new proportion barely moved. This is a real feature of this benchmark's task mix, not a sign the fix did nothing: repetition is scoped to a single task (a single `runLoop` invocation, per the Decisions above), and most of the six benchmark tasks are single-turn — `capital-of-france` and both messages of `remember-favorite-number` each make exactly one call, on which the tool-definition block is unavoidably new (there is no earlier call in that task to have repeated it). Only the multi-turn tasks (`shell-arithmetic`, `read-os-release`, `word-count-skill`, and the main loop of `subagent-three-sums`) have a second call within the same task on which the block counts as repeated. A workload with more multi-turn tasks per conversation would show a larger correction here; this benchmark's task mix happens not to.
