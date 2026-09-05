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

**Shell output is compressed by RTK rather than by more truncation of our own.** Truncation is a blunt instrument: it keeps the first N bytes and hopes the answer is there. Command output is structured — repeated log lines, listings, test reports — and a tool that understands that structure removes far more while destroying less. RTK ("Rust Token Killer", https://github.com/rtk-ai/rtk) does exactly that, as a single dependency-free Rust binary, and there is no reason to reimplement it.

The alternative considered was rejecting it, on the grounds that its measured effect on this task set is roughly 0.03% (`execute_command` produced 15 tokens of output across the entire baseline, largest single result 8 bytes). That reasoning was rejected because this change already keeps its own tool-result limit and bounded file reads on the opposite argument — that the benchmark points its tools at small, known targets while real use has no such bound. The same argument cannot qualify one mechanism and disqualify another. Either the benchmark is the workload, in which case the limit and the bounded reads go too, or it is not, in which case RTK stays.

**Compression runs before the limit, not instead of it.** RTK only sees shell output; `read_file`, `read_skill` and `spawn_subagents` results never pass through it, so the configured tool-result limit is still the only thing bounding those. Ordering compression first and applying the limit to its output means the limit remains the guarantee — nothing enters the conversation above it — while compression determines how much survives underneath. Applying the limit first would truncate text before the tool that knows how to shorten it intelligently ever saw it.

**Compression discloses itself, for the same reason truncation does.** The disclosure argument above applies with more force here, not less: a truncated result is visibly cut off, whereas a compressed one reads like ordinary command output and gives the model no signal that it is a summary. An undisclosed summary is the failure mode where the model quotes back something the command never printed.

**Putting a third-party binary inside the sandbox is a security decision, and is recorded as one.** `sandbox/Dockerfile` is `alpine:latest` with `coreutils`, `curl` and `ca-certificates`, run `--read-only` with `--network none`. That image is the boundary around commands the model chooses. RTK adds a compiled binary to it that, unlike everything else this change writes, cannot be read in a dependency tree or reviewed in a diff. The judgement made here is that a binary which only transforms text on stdout, in a read-only container with no network, has little to work with even if it were hostile — but that judgement is the reason to record it, not a reason to skip recording it. An operator who disagrees should be able to find the decision rather than discover the binary.

**Keep the head and, where useful, the tail of a truncated result.** Command output puts the interesting part at either end — a header at the top, an error or summary at the bottom — and cutting only the tail routinely discards the failure message that made the output worth reading.

**Compaction summarizes; it does not drop.** Dropping the oldest turns is simpler and loses facts the user expects the agent to remember, turning a token optimization into a visible behaviour regression. Summarizing costs an inference call when the threshold is crossed, which is a real cost that must be counted against the saving rather than ignored.

**Compaction affects the request, never the store.** The stored conversation stays complete. If compaction is later found to lose something important, the fix is to change how requests are assembled, not to recover a history that was destroyed. `/new` remains the only thing that removes turns.

**The constant block is reduced by removing redundancy, and the line is drawn at whether the model loses something it was using.** The baseline puts roughly 600 of every call's ~700 input tokens in a block that never changes: ~542 estimated tokens of tool definitions and ~60 of instruction text, resent on all 70 calls. Tool output is 2.4% of input and conversation history 0.5%. On this provider that block is also the only thing that moves the measured number, because `prompt_eval_count` reports the full prompt size no matter what the engine reuses internally.

Two reductions are taken, and each removes wording rather than capability:

*`spawn_subagent` is no longer advertised* (~104 estimated tokens). `spawn_subagents` implements the singular case by calling `spawnSubagentTool.execute` once per task, so `spawn_subagents(["x"])` and `spawn_subagent("x")` are the same operation. The tool object stays; only its advertisement goes. The recursion guard is unaffected — it excludes both names, and excluding a name that is not registered is a no-op.

*Argument descriptions that restate the schema are dropped* (~91 estimated tokens). `"path: Path to the file to read"` on an argument named `path` of type `string` tells the model nothing the schema has not already told it. `read_skill`'s `"Exact skill name, as shown in the skill index"` does, and is kept, as are the two describing optional model selection.

A third candidate — *the instruction text stops repeating the tool definitions* (~30 estimated tokens, e.g. "inside the sandbox" appears in each tool description and again in the instruction) — was implemented and then reverted. It measurably regressed correctness on the actual benchmark: two different trims (dropping the whole capability-listing sentence, then a smaller trim keeping the sentence but dropping only "in an isolated sandbox") each made `qwen2.5` return an empty response instead of calling a tool it needed (`spawn_subagents`, then `read_skill`, on different benchmark tasks), reproduced deterministically. The fully untrimmed instruction is the one that passes every benchmark task, so it is kept as-is — see notes.md, "Reducing the agent's instructions — DROPPED". The `context-management` spec's requirement for this candidate was removed accordingly.

The alternative, stripping every argument description, was measured at a further ~7 percentage points and rejected: it would take `read_skill`'s constraint with it, and the correctness gate exists precisely to stop the change trading answers for tokens. A larger alternative — not advertising `write_file` and `list_files`, unused anywhere in the benchmark — was rejected outright as a capability cut wearing an optimization's clothes: "unused across six tasks" is not evidence of "unneeded".

Where it is unclear whether wording carries information, the wording stays. The measurable cost of keeping a description is a few tokens; the cost of removing one the model was relying on is a wrong answer, and the benchmark's six tasks are too few to reliably detect that.

**Prefix stability is a constraint on assembly, not a caching feature we implement.** Nothing here caches anything: the requirement is only that the leading part of every request is byte-identical so a provider that can reuse a prefix is able to. That makes it cheap to satisfy and impossible to get a misleading measurement from — and it must be asserted by test, since the failure mode is a stray timestamp or a map iteration order that varies, neither of which is visible by reading the output.

**Ollama reports no cache statistics.** The benefit of prefix stability therefore cannot be read from a provider-reported cache hit rate. It shows up, if at all, in the repeated-input measurement the instrumentation computes and in latency. This limitation is stated rather than worked around, and it means prefix stability is the one candidate here whose payoff may not be directly measurable on the current provider — a reason to keep it (it costs nothing and is correct regardless) rather than to claim a number for it.

## Risks / Trade-offs

**Truncation and compaction both remove information the agent might need** → The mechanism that catches this is the per-task correctness comparison, not the overall rate: a 2-point overall drop could be one task failing every time, which matters far more than noise spread across all of them. Read the per-task comparison before the headline number.

**Compaction's summarization spends tokens to save tokens** → Crossing the threshold triggers an inference call. On a conversation that never grows much further, that call can cost more than it saves. The threshold has to be set from the measured distribution of conversation lengths, not guessed, and the summarization call's own tokens must be counted in the after-snapshot — it would otherwise be hidden from exactly the measurement meant to justify it.

**The benchmark may not represent long conversations** → Compaction only engages past a size threshold, and a task set built around checkable answers skews short. If the set contains only one multi-turn task, compaction's effect will be measured on almost nothing while it runs constantly in real use. Check what fraction of benchmark tokens the compaction path actually touches before believing its measured contribution either way.

**The RTK binary may not run in the sandbox image at all** → `sandbox/Dockerfile` builds on `alpine:latest`, which is musl-based, while prebuilt Linux binaries are commonly linked against glibc. A musl or statically linked build may be required, and "the binary is installed" is not the same as "the binary runs here". Verifying it executes inside the built image is a task in its own right, before anything is wired to depend on it.

**Changing the sandbox image changes the conditions the baseline was recorded under** → The baseline snapshot was taken against the current image. Adding RTK changes what `execute_command` returns, which is the point, but it means RTK cannot be evaluated by reasoning about it — it needs its own labelled benchmark snapshot compared against the baseline, exactly as every other optimization here does, and the correctness gate applies to it. A compression that silently drops the line carrying the answer would show up as a correctness regression on a task, and that is the only mechanism that would catch it.

**Hitting 30% is not guaranteed** → The target was set before the baseline existed. If the measurements show the achievable reduction is smaller without hurting correctness, report the real number and what it cost, rather than tuning limits down until the number appears. A truthful 22% with correctness held is a better outcome than a 30% that the benchmark set happens not to punish. (Measured outcome: −5.7%, see notes.md §8.3–8.8.)

**Sections 7.1, 7.4, and 3 are not safely independent of each other on the tested model** → Measured during section 8: dropping `spawn_subagent`'s advertisement (7.1) and dropping restating argument descriptions (7.4) together, *without* section 3's `start_line`/`end_line` addition to `read_file`, reproducibly makes `qwen2.5` return an empty response instead of calling `read_skill` on the benchmark's `word-count-skill` task. Neither 7.1 nor 7.4 alone causes this; the shipped code never hits it because section 3 is always present alongside them. Likely a token/prompt-boundary sensitivity in this specific (quantized) model rather than a semantic conflict, but it is real, reproducible, and means these three cannot be treated as freely independent toggles — see notes.md §8.3–8.8 for the isolated reproduction.
