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
