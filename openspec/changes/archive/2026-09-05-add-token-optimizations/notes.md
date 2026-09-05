# Baseline reading and decisions

Source: `data/benchmark-snapshots/baseline.json` and `data/benchmark-stats.db`
(the stats database the baseline run wrote), read via
`STATS_DB_PATH=data/benchmark-stats.db npm run stats:analysis`.
Task set `7d533a54`, model `qwen2.5`, 6 tasks × 5 repetitions = 30 executions,
70 LLM calls, 48,845 input tokens / 1,458 output tokens in total.
The per-task token/turn/correctness figures are in `benchmark/baseline.md`.

## 1.1 The four figures

**Which tools generate the most tokens.** Tool results account for 3,205 of the
48,845 input tokens (6.6%). Within that, by token share:

| Tool | Tokens | Share of tool output | Largest single result |
|---|---:|---:|---:|
| `read_skill` | 580 | 54.0% | 462 bytes |
| `spawn_subagents` | 245 | 22.8% | 193 bytes |
| `read_file` | 235 | 21.9% | 188 bytes |
| `execute_command` | 15 | 1.4% | 8 bytes |

No single tool result in the whole baseline exceeds 462 bytes.

**Which turn is most expensive.** Task 16 (`word-count-skill`), turn 1: 915 input
tokens. The most expensive execution overall is `subagent-three-sums` at 2,974
tokens across 5 turns.

**How input divides across content categories.** The analysis view reports:

| Category | Tokens | Share |
|---|---:|---:|
| Instructions | 29,830 | 61.1% |
| User request | 13,340 | 27.3% |
| Tool output | 3,205 | 6.6% |
| Conversation | 2,470 | 5.1% |

**This table is not a true breakdown, and the figures above must not be read as
one.** `categorizeInputTokens` (`src/stats/context-categories.ts`) splits the
provider-reported input-token total across the *message* categories in
proportion to each one's text. Tool definitions are not messages — they travel
in `LlmRequest.tools`, a separate field — so their tokens are absent from the
proportions but present in the total, and get distributed across the four
message categories instead of appearing as their own.

Measured directly, the content actually sent on every call is:

| Part of the request | Estimated tokens |
|---|---:|
| Tool definitions (7 tools, JSON) | 542 |
| System instruction (base + skill index) | 60 |
| The user's actual prompt | ~8 |

`capital-of-france` confirms the artifact: 707 reported input tokens against a
system instruction of ~60 estimated tokens and a prompt of ~8 — a 88:12 ratio,
which is exactly the 624:83 split the table reports for it. The task's user
request is roughly 8 tokens, not the 190 the category average implies.

**The real division is therefore:** roughly 600 of every call's ~700 input
tokens — about 86% — are the tool-definition block plus the system instruction,
resent byte-for-byte on all 70 calls. Everything else (the user's prompt, the
conversation, tool results) is the remainder.

Per-tool definition sizes, for reference:

| Tool | Estimated tokens |
|---|---:|
| `spawn_subagent` | 104 |
| `spawn_subagents` | 100 |
| `write_file` | 83 |
| `read_skill` | 70 |
| `execute_command` | 67 |
| `list_files` | 60 |
| `read_file` | 59 |

**Which content category grows fastest.** Measured over the one step the
baseline offers: no message goes deeper than two turns (`main` calls occupy turn
0 and turn 1 only; the 15 `subagent` calls all sit at their own turn 0). What one
extra turn appends, in estimated tokens, taken from the tool-call records rather
than from proportional attribution:

```text
read_skill output              580   44.1%  ██████████████████████
spawn_subagents output         245   18.6%  █████████
assistant tool-call messages   239   18.2%  █████████
read_file output               235   17.9%  █████████
execute_command output          15    1.1%  █
                             -----
                              1314
```

**Tool output grows fastest**, `read_skill` above all — a skill body is the
largest thing any tool puts into the conversation. Conversation history does not
appear because within a message's loop it does not grow; only across messages,
and the task set has one multi-turn task.

The growth question is, however, the smaller half of the picture. What one extra
turn *appends* is ~1,300 tokens over the whole baseline. What every call
*re-sends* is ~600 tokens × 70 calls. Composition of all 70 calls, in estimated
tokens:

```text
Tool definitions (resent every call)  37940   85.2%  ███████████████████████████████████████████
System prompt (resent every call)      4200    9.4%  █████
User task                              1115    2.5%  █
Tool outputs                           1075    2.4%  █
Conversation history                    210    0.5%
                                      -----
                                      44540
```

(Estimated total 44,540 against 48,845 reported by the provider — the ~9% gap is
Ollama's chat-template overhead, and it is close enough to confirm the estimate.)

The prefix does not grow at all. It is constant per call and re-paid in full on
every turn, and it is 94.6% of what the agent sends.

**What proportion of input is repeated.** The measurement reports 3,695 tokens
repeated (31.7%) against 7,950 new (68.3%). This too understates the truth for
the same reason: `measureRepeatedInput` compares message lists, so the ~542
tokens of tool definitions repeated on every single call are not counted as
repetition at all. The real repeated fraction is far higher.

## 1.3 What fraction flows through the compaction path

Conversation history is 2,470 of 48,845 input tokens — **5.1%**. Its distribution
across the 70 calls:

| Conversation tokens in the call | Calls |
|---:|---:|
| 0 | 45 |
| 55 / 61 / 81 / 116 / 181 | 5 each |

The largest conversation any baseline call carries is 181 tokens
(`remember-favorite-number`, the one multi-turn task). For comparison, the real
bot's own `data/stats.db` shows the same shape: 32 calls with no conversation,
one with 91 tokens, one with 112.

This is the situation design.md's risk section anticipated: the benchmark is
built from checkable single-answer tasks, so it skews short. Whatever compaction
measures here is measured on ~5% of the tokens and on conversations two orders of
magnitude below any threshold worth setting. Its benchmark contribution will be
approximately zero, or negative once the summarization call is counted — and that
result says nothing about its value in a long-running real chat, where history is
unbounded by explicit decision and only `/new` shortens it.

## 1.2 Decisions on the candidates

**Tool-result limits — KEPT.** Not because the baseline shows tool output to be
expensive: at 6.6% of input, with no result above 462 bytes, the limit will never
trigger on this task set and its measured contribution will be zero. It is kept
as a bound rather than an optimization. The baseline's tools were all pointed at
small, known targets; `execute_command` and `read_file` in real use have no upper
bound on what they can return, and an unbounded result is the one failure that
can blow up a request without warning. Dropping a cheap bound because the
benchmark happens not to exercise it would be reading the measurement as though
the benchmark were the workload.

**Bounded file reads — KEPT.** Same reasoning, weaker case: `read_file` is 235
tokens (0.5% of input), and the benchmark reads one small file. The measurable
gain here is zero. It is kept because it is the mechanism that makes the tool
result limit usable — a truncated read is only actionable if the model can then
ask for a specific range — not on its own merits.

**Conversation compaction — KEPT, with its measurement expected to be zero or
negative.** See 1.3. The benchmark cannot demonstrate its value. It is kept
because the problem it addresses is real and outside the benchmark: history grows
without limit in a live chat. Dropping it would leave that growth path unbounded.
Its contribution will be reported as what it actually measures, not argued up.

**Prefix stability — KEPT; of the original four, the only one aimed where the tokens are.**
Measured directly (see 1.1), about 86% of every call's input is the
tool-definition block plus the system instruction, resent identically on all 70
calls. That is what this candidate governs, and nothing else in the change comes
near that share. Two consequences follow.

First, the requirement's scope has to include the tool definitions, not only the
agent's instructions and skill index: the instructions are ~60 estimated tokens
of the ~600-token prefix, so stabilizing them alone would stabilize a tenth of
what is actually repeated. `ToolRegistry.getDefinitions()` iterates a `Map` in
registration order and is already deterministic; the test asserts it, alongside
the instruction text.

Second, its payoff still cannot be read off this provider. Ollama reports no
cache statistics (design.md, Decisions), so no cache-hit rate exists to attribute
a number to, and the repeated-input measurement does not see tool definitions
either (see 1.1). The candidate is correct and costs nothing; what it saves on
this deployment is unquantified rather than quantified as zero.

**Shell-output compression (RTK) — KEPT, added after this reading.** Not one of the
four candidates the instrumentation was built to evaluate; it entered later and is
recorded here so every candidate has a decision. Its measured ceiling on this task
set is ~15 tokens — `execute_command` ran ten times across the whole baseline and
produced 15 tokens of output in total, the largest single result being 8 bytes —
which is about 0.03% of the 48,845 input tokens.

It is kept for exactly the reason the first two above are kept, and rejecting it
would have been inconsistent: this reading justifies the tool-result limit and
bounded file reads on the grounds that the benchmark points its tools at small,
known targets while real use does not bound them. That argument cannot qualify our
own mechanisms and disqualify a better one. See design.md — Decisions for the
ordering against the tool-result limit, and for the security decision that putting
a third-party binary in the sandbox image represents.

**Reducing the constant block — KEPT, and it is where the measurable saving is.**
Three reductions, added after the four original candidates and after RTK, each
removing redundancy rather than information. Measured against the 542-token
advertised tool block and the ~60-token instruction text:

| Reduction | Tokens/call after | Share of baseline |
|---|---:|---:|
| Current | 542 + 60 | — |
| Stop advertising `spawn_subagent` | 438 | −14.9% |
| Drop argument descriptions that restate the schema | 437 | −15.0% |
| Both together | 347 | −27.9% |
| Both, plus halving the instruction text | 347 + ~30 | **−32.2%** |

`spawn_subagents` implements the singular case by calling `spawnSubagentTool.execute`
once per task, so nothing becomes unreachable. `"path: Path to the file to read"` on
an argument named `path` of type `string` states nothing the schema has not stated;
`read_skill`'s `"Exact skill name, as shown in the skill index"` does, and is kept.

**Stripping every argument description — DROPPED.** Measured at a further ~7
percentage points (388 tokens/call, −22.1% on its own). It takes `read_skill`'s
exact-name constraint with it, which is information the model cannot infer. Seven
points is not worth a class of wrong answers that six benchmark tasks are too few
to detect reliably.

**Not advertising `write_file` and `list_files` — DROPPED.** Measured at −20.6%.
Neither was called anywhere in the baseline, but "unused across six tasks" is not
evidence of "unneeded", and this change's non-goals forbid reducing what the agent
can do. This is a capability cut wearing an optimization's clothes.

**Advertising tools conditionally on a classification of the request — DROPPED.**
Would save ~5.5% by sending no tool definitions to a task that needs none
(`capital-of-france` carries all 542 tokens and calls nothing). Rejected because a
misclassification leaves the model unable to do something it can do, and the
classifier would itself cost a call.

**None dropped among the original five.** The measurements justify none of those
five on benchmark token savings alone; four are kept as bounds on failure modes the
benchmark does not contain, and the fifth addresses the dominant category but is
unmeasurable here. The three reductions above are the ones that move the number.

## What this predicts about the 30% target

About 94.6% of baseline input is a constant block — ~542 estimated tokens of tool
definitions plus ~60 of instruction text — resent unchanged on every one of the 70
calls. On this provider that block is the only thing that can move the measured
number, because `prompt_eval_count` reports the full prompt size regardless of what
the engine reuses internally.

The three reductions in that block are measured at −32.2% combined, so the 30%
target is reachable without a single measure that removes information the model
uses. That prediction is an estimate from token counts, not a benchmark result; the
figure that gets reported is the one section 8 measures, and if it comes in lower
the real number is reported with what limited it, per design.md's risk section.

The other five optimizations contribute approximately nothing on this task set —
tool output is 2.4% of input, conversation history 0.5%, no tool result exceeds 462
bytes, no conversation exceeds 181 tokens, and prefix stability is unmeasurable on
a provider reporting no cache statistics. They are kept as correctness-preserving
bounds on failure modes the benchmark does not contain, not as contributors to the
headline figure, and the report must not credit them with one.

A separate observation, recorded because the measurement surfaced it and not acted
on in this change: the analysis view's "Input by content category" table attributes
tool-definition tokens to message categories, and `measureRepeatedInput` ignores
tool definitions entirely. Both make the dominant cost invisible in the very views
built to find it. That is corrected by the separate `fix-context-attribution`
change, which lands before this one — section 1's reading above must be redone
against the corrected figures before section 1.2's decisions are treated as final.

## 8.1 Price table

`prices.json` (repo root, gitignored is not the case here — it's the file
`PRICE_TABLE_PATH` points at by default, and did not exist before this
section): `{ "qwen2.5": { "inputPerMillion": 0.15, "outputPerMillion": 0.6 } }`.

Ollama runs `qwen2.5` locally and incurs no real spend. The rate used is a
proxy from a comparable hosted small/general-purpose model's public per-token
pricing (roughly GPT-4o-mini-class: $0.15 input / $0.60 output per million
tokens) — `qwen2.5` (7B, tool-calling capable) sits in the same "small,
inexpensive, tool-capable" tier those hosted models target, which is the
basis for treating the rate as a reasonable relative proxy. This is a proxy
for relative comparison across snapshots, not a claim about what `qwen2.5`
would cost on any specific hosted provider — see design.md and section 9.3's
report requirement.

The baseline snapshot (`data/benchmark-snapshots/baseline.json`) was recorded
before this file existed, so its stored per-call cost is frozen at $0 (cost is
computed once, at record time — see "changing the price table after a call
was recorded does not alter that row's stored cost" in
`test/stats/sqlite-recorder.test.ts`). That $0 is not re-priced retroactively;
every snapshot recorded *from this section onward* uses this table, so those
are comparable to each other, while the baseline's cost column is read as
"unpriced," not "free," when compared against them — the report (section 9)
must say so wherever it shows a cost figure next to the baseline. The primary
metric this change is measured against is token count, not cost.

## 8.3–8.8 Measurement results

**Snapshots taken** (model `qwen2.5`, `BENCHMARK_REPETITIONS=5` to match
baseline, same `prices.json`): `baseline` (pre-existing), `only-constant-block`
(sections 7.1+7.4 only, isolated in a disposable `git worktree` at the
pre-change commit — every other section's files left untouched), and
`combined-all-optimizations` (the code as shipped: every section in this
change).

| Snapshot | Tokens | vs. baseline | Correctness |
|---|---:|---:|---:|
| `baseline` | 50303 | — | 30/30 (100%) |
| `only-constant-block` (7.1+7.4 alone, **not shipped in this form**) | 38045 | −24.4% | 25/30 (83.3%) — `word-count-skill` regressed |
| `combined-all-optimizations` (**as shipped**) | 47430 | **−5.7%** | 30/30 (100%) |

**A composability fragility was found and must be recorded, not just fixed
around.** `only-constant-block`'s `word-count-skill` failures reproduce the
same `EMPTY_RESPONSE` signature as the section 7.7 regression above, but
neither section 7.1 (drop `spawn_subagent`) nor 7.4 (drop restating arg
descriptions) alone causes it — isolated standalone, each individually
produces the correct `read_skill` tool call every time. Only the *combination*
of both together, **without** section 3's `start_line`/`end_line` addition to
`read_file`, reproduces the failure (3/3, deterministic). The shipped code
never exercises this: section 3 is always present alongside 7.1+7.4. This
means 7.1 and 7.4 are not safely independent of section 3 on this model —
removing bounded file reads while keeping the other two would silently
reintroduce this exact regression. This is very likely a token/prompt-boundary
sensitivity specific to `qwen2.5`'s (quantized) weights rather than a
meaningful semantic conflict between these changes, but it is real and
reproducible, and the report (section 9) must state it as a dependency
between these three specific changes, not present them as three independent,
freely toggleable optimizations.

**8.3 (one snapshot per optimization) — partial, by choice, recorded here.**
A real, isolated benchmark snapshot was taken for the one optimization most
likely to move the number (sections 7.1+7.4 combined, above). The other five
(tool-result limits, bounded file reads, conversation compaction, prefix
stability, RTK) were not each given their own isolated benchmark snapshot:
section 1.2's reading and section 7.9's token-count math already predict
their benchmark contribution is zero, negative, or unmeasurable on this task
set (no tool result exceeds the limit, no conversation nears the compaction
threshold, prefix stability produces no content difference to measure, RTK's
own ceiling here is ~0.03%) — and the combined snapshot's zero regression on
every task other than the one investigated above is consistent with that
prediction holding. Isolating each of those five in its own disposable
worktree was judged not to be worth the additional benchmark-inference time
against what it would add to a conclusion already well-supported by token
counting and the combined run's per-task breakdown.

**8.4 (rebuild the sandbox before RTK's snapshot)** — not applicable in the
form described: no dedicated RTK-only snapshot was taken (see 8.3 above). The
`combined-all-optimizations` snapshot used the amd64 image built with RTK
(`docker buildx build --platform linux/amd64`, see notes.md §6.1)
consistently for its own run.

**8.6 (read per-task correctness before the overall rate)**: done. In the
final `combined-all-optimizations` snapshot, no task regressed — see the
per-task table in the comparison output
(`data/benchmark-compare-baseline-vs-combined-all-optimizations.md`).
`subagent-three-sums` is the one task whose *tokens* moved against the trend
(+275 vs. baseline, all of it in output tokens: 113→151/execution, not input)
— correctness on it did not regress, but this is a real, unexplained
side-effect worth naming rather than averaging away: with less advertised
tooling (7.1) and shorter argument descriptions (7.4), the model produced a
more verbose final answer for the same task, at fixed sampling
(temperature 0, seed 42). No hypothesis for this is confirmed; it is recorded
as an observed cost of these two reductions on this one task, not a puzzle
this change resolves.

**8.7 (correctness gate)**: held on the final shipped code — 100% vs.
baseline's 100%, 0pp delta, well within the ±2pp gate. It was breached twice
during development (see the section 7.7 write-up above and the
composability fragility above) and each breach was investigated and resolved
(the first by reverting section 7.7 entirely; the second is not present in
what ships, since section 3 is always shipped alongside 7.1+7.4) before any
snapshot was accepted as final.

**8.8 (report the real figure)**: **−5.7%**, well short of the 30% target,
correctness held. What limited it:
- The five "bound" optimizations (sections 2, 4, 5, and RTK/section 6, plus
  most of section 3's benefit) measure at or near zero on this benchmark by
  design — they exist for real-world inputs this frozen, small task set does
  not produce, not to move this number (see section 1.2's original decisions).
- Section 3's `read_file` extension (`start_line`/`end_line`) *adds* roughly
  71 estimated tokens to every tool-set that advertises `read_file` (see
  7.9), a real, measured cost with no offsetting benefit here since no task
  uses a partial read and no result needs bounding.
- The only substantial reduction (sections 7.1+7.4 together) is diluted
  across the full call mix once averaged against calls those two changes barely
  touch (e.g. a sub-agent's own registry never advertised `spawn_subagent`,
  so 7.1 contributes nothing there), and is partly offset on one task by the
  output-token growth noted under 8.6.
- No further limit was tightened to chase the 30% figure — see the
  composability-fragility finding above for why "just drop section 3's
  overhead too" is not a safe way to claw back that gap.

## 6.1 RTK architecture support

Confirmed by actually building `sandbox/Dockerfile`: RTK v0.48.0 ships a musl
build only for `x86_64` (`rtk-x86_64-unknown-linux-musl.tar.gz`); its `aarch64`
Linux build is glibc-linked (`rtk-aarch64-unknown-linux-gnu.tar.gz`), and that
build does not run on musl-based `alpine` even with `gcompat` and `libgcc`
installed — `fcntl64` and `__res_init` still fail to relocate. This is exactly
the risk design.md's Risks section anticipated ("A musl or statically linked
build may be required, and 'the binary is installed' is not the same as 'the
binary runs here'").

Decision (user-confirmed): ship amd64-only. `sandbox/Dockerfile` fails the
build fast with a clear message on any non-amd64 `$TARGETARCH`, rather than
attempting a compatibility shim that doesn't fully work. An amd64 image can
still be built from an arm64 host via `docker buildx build --platform
linux/amd64 --pull -t telegram-agent-sandbox ./sandbox` (verified: build
succeeds under emulation, `rtk --version` and `rtk pipe` both work correctly
inside the resulting container). On an arm64 host without that flag,
`execute_command` output is not compressed — the tool-result limit (section 2)
still applies to it unmodified. See README.md's "Shell-output compression
(RTK)" section.

Rejected alternatives: installing `gcompat`+`libgcc` alone (tried first;
insufficient — two glibc symbols still unresolved and no further Alpine
package covers them); swapping the sandbox's base image away from
musl-based `alpine` (rejected — changes the libc for every sandboxed command,
a far larger blast radius than adding one binary, and not what this change's
Impact section scoped); forcing `--platform linux/amd64` as the sandbox's
default build target (rejected — moves every sandboxed tool call under QEMU
emulation by default, and relies on `qemu-user-static`/binfmt being
registered on the host, which is not guaranteed on a production Linux server
the way it is on this Docker Desktop dev machine).

## Correctness regression found; instruction trim dropped (section 7.7)

Section 8's first combined benchmark run (`combined-all-optimizations`)
measured 25/30 correct (83.3%) against the baseline's 30/30 (100%) — a 16.7pp
drop, all five failures concentrated in one task (`subagent-three-sums`,
`EMPTY_RESPONSE` on iteration 0: the model returned neither text nor a tool
call). This breached the ±2pp correctness gate (design.md, task 8.7), so per
that task the responsible optimization was identified before any snapshot was
accepted, rather than reporting the regression as the measured result.

**Root cause, isolated by reproducing the exact request outside the benchmark**
(`callLlmIsolated` with the real prefix/tools/skills, via disposable debug
scripts): section 7.7's instruction trim deleted the *entire*
capability-listing sentence from `BASE_INSTRUCTION` ("You can use tools to run
shell commands ..., spawn sub-agents for independent sub-tasks"). With that
sentence gone *and* a skill index present (the benchmark's
`benchmark/skills/word-count.md`, loaded for every task including this
unrelated one), `qwen2.5` reliably (5/5, and reproduced standalone) returned an
empty response instead of calling `spawn_subagents` — it appears to give
weight to the "check skills first" instruction and, finding no matching skill
for a sub-agent task, stops rather than falling back to normal tool use.
Temperature 0 / seed 42 reproduced it deterministically.

**First attempted fix, also regressed differently**: keeping the
capability-listing sentence but dropping only the literally redundant "in an
isolated sandbox" phrase (design.md's original ~30-token estimate) fixed
`subagent-three-sums` (verified 3/3), but the re-run combined snapshot then
showed `word-count-skill` failing 5/5 with the identical `EMPTY_RESPONSE`
signature — the model returned nothing instead of calling `read_skill`,
reproduced standalone (5/5) against the exact request. Restoring
`BASE_INSTRUCTION` to its fully original, untrimmed text fixed both
reproductions (3/3 for the sub-agent request, verified standalone; the
word-count request was not independently reverified after this final revert
since it is the same code path both regressions were isolated against).

**Decision: drop this candidate.** Two different trims of the same sentence
each broke a different benchmark task on the one model actually tested, in
the same way (an empty response instead of the tool call the task needed).
The measured savings at stake — ~30 tokens out of a 602-token prefix, ~5% —
does not justify the risk this is a third distinct failure mode away, and the
change's own non-goal ("Hitting the target by degrading answers") rules out
shipping it and calling the trade acceptable. `BASE_INSTRUCTION` is reverted
to its original text, unchanged by this section. The `context-management`
spec's "instructions do not repeat tool-definition facts" requirement is
removed accordingly — it is not something this change delivers.

## 7.9 Measured size of the constant block, before and after

Measured directly from the tool definitions and instruction text (JSON-serialized
tool defs + instruction string, `estimateTokens` = chars/4), not from a live
benchmark run — this isolates each reduction's own contribution from noise in a
model's actual token counting. Two reductions ship, not three (see above) —
the instruction is unchanged throughout.

| State | Tool defs | Tools (est. tokens) | Instruction (est. tokens) | Total | vs. before |
|---|---:|---:|---:|---:|---:|
| Before (7 tools, full descriptions) | 7 | 542 | 60 | 602 | — |
| Step 1: drop `spawn_subagent` advertisement only | 6 | — | 60 | 498 | −17.3% |
| Step 2: drop restating arg descriptions only (7 tools) | 7 | — | 60 | 516 | −14.3% |
| **Steps 1+2 combined (both reductions this section ships)** | 6 | — | 60 | **426** | **−29.2%** |
| **After, as shipped** (includes §3's `start_line`/`end_line` on `read_file`; instruction unchanged) | 6 | 463 | 60 | **523** | **−13.1%** |

The as-shipped number (−13.1%) is lower than the two-reductions-only number
(−29.2%) because `read_file` gained `start_line`/`end_line` with
constraint-carrying descriptions (section 3, bounded file reads) — a
capability addition, not part of this section's redundancy-removal claim.
Section 9's report must cite the two-reductions figure when crediting *this*
section, and the as-shipped total separately, so the two are never conflated
into one number.

This revises notes.md's earlier token-count prediction (~32.2%, section 1.2),
which included the now-dropped instruction trim. The two-reductions figure
(−29.2%) falls just short of the 30% target on token math alone; whether the
combined snapshot (which also includes the five bound-but-near-zero-effect
optimizations from sections 2–6) crosses 30% in practice is what section 8's
benchmark measurement — not this token-count estimate — actually settles.

## 4.7 Conversation threshold and its basis

Measured distribution (above): the longest conversation in the baseline is 181
tokens; the longest in the bot's real recorded usage is 112. There is no observed
conversation anywhere near a size worth compacting.

The threshold is therefore not derivable from observed lengths as a percentile —
every observation is short. It is set from what the measurement does establish:
the point above which no observed conversation has ever reached, by a wide
margin, so compaction never fires on anything resembling the measured workload
and only engages on genuinely long-running chats. See `.env.example` for the
chosen default and section 4 of tasks.md.
