## Context

See proposal.md — Why. This change is the last of the sequence and depends on what precedes it: `extend-observability-instrumentation` records where tokens go, `add-observability-dashboard` reads it back, and `add-agent-benchmark` provides the frozen task set and the baseline snapshot every claim here is measured against.

Two facts from earlier work shape the approach. Conversation history is unbounded by explicit decision (`add-chat-context-history` — the only thing that shortens it is `/new`), so a long-running chat's request grows without limit. And the agent's instructions plus the skill index were deliberately made deterministic when they were introduced, precisely so that this change could rely on a stable prefix.

## Goals / Non-Goals

**Goals:**
- At least a 30% reduction in tokens over the benchmark set, with correctness down no more than 2 percentage points.
- Attribute the reduction to individual changes, not just to the combination.
- Leave the agent able to do everything it could do before.

**Non-Goals:**
- Reaching the target by any means. The correctness gate is the constraint.
- Optimizing anything the baseline does not show to be expensive.
- Touching the benchmark set. It is frozen; the baseline is worthless otherwise.

## Decisions

**The set of optimizations is chosen from the baseline, not fixed here.** The four in the proposal are candidates, and the instrumentation exists to rank them. An optimization the measurements do not justify is dropped and the reason recorded — implementing all four regardless would be building for a problem that was measured not to exist, and each one adds a way for the agent to see less than it needs.

**Measure each optimization separately, then together.** Applying all of them and comparing to the baseline gives one number and no understanding. Separate snapshots per optimization cost more benchmark runs and buy the ability to say which change earned the reduction — and, when correctness drops, which change cost it. Without that, a regression means bisecting after the fact.

**Truncation discloses itself.** A silently truncated tool result is indistinguishable to the model from a complete one, so it will reason confidently over a fragment. Stating the truncation and the full size turns a silent wrong answer into a narrower follow-up request — which costs a turn, but a correct answer in two turns beats a wrong one in one. This is the single most likely source of correctness regression in this change, which is why it is disclosed rather than silent.

**Keep the head and, where useful, the tail of a truncated result.** Command output puts the interesting part at either end — a header at the top, an error or summary at the bottom — and cutting only the tail routinely discards the failure message that made the output worth reading.

**Compaction summarizes; it does not drop.** Dropping the oldest turns is simpler and loses facts the user expects the agent to remember, turning a token optimization into a visible behaviour regression. Summarizing costs an inference call when the threshold is crossed, which is a real cost that must be counted against the saving rather than ignored.

**Compaction affects the request, never the store.** The stored conversation stays complete. If compaction is later found to lose something important, the fix is to change how requests are assembled, not to recover a history that was destroyed. `/new` remains the only thing that removes turns.

**Prefix stability is a constraint on assembly, not a caching feature we implement.** Nothing here caches anything: the requirement is only that the leading part of every request is byte-identical so a provider that can reuse a prefix is able to. That makes it cheap to satisfy and impossible to get a misleading measurement from — and it must be asserted by test, since the failure mode is a stray timestamp or a map iteration order that varies, neither of which is visible by reading the output.

**Ollama reports no cache statistics.** The benefit of prefix stability therefore cannot be read from a provider-reported cache hit rate. It shows up, if at all, in the repeated-input measurement the instrumentation computes and in latency. This limitation is stated rather than worked around, and it means prefix stability is the one candidate here whose payoff may not be directly measurable on the current provider — a reason to keep it (it costs nothing and is correct regardless) rather than to claim a number for it.

## Risks / Trade-offs

**Truncation and compaction both remove information the agent might need** → The mechanism that catches this is the per-task correctness comparison, not the overall rate: a 2-point overall drop could be one task failing every time, which matters far more than noise spread across all of them. Read the per-task comparison before the headline number.

**Compaction's summarization spends tokens to save tokens** → Crossing the threshold triggers an inference call. On a conversation that never grows much further, that call can cost more than it saves. The threshold has to be set from the measured distribution of conversation lengths, not guessed, and the summarization call's own tokens must be counted in the after-snapshot — it would otherwise be hidden from exactly the measurement meant to justify it.

**The benchmark may not represent long conversations** → Compaction only engages past a size threshold, and a task set built around checkable answers skews short. If the set contains only one multi-turn task, compaction's effect will be measured on almost nothing while it runs constantly in real use. Check what fraction of benchmark tokens the compaction path actually touches before believing its measured contribution either way.

**Hitting 30% is not guaranteed** → The target was set before the baseline existed. If the measurements show the achievable reduction is smaller without hurting correctness, report the real number and what it cost, rather than tuning limits down until the number appears. A truthful 22% with correctness held is a better outcome than a 30% that the benchmark set happens not to punish.
