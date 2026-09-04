## Why

With the instrumentation, the views that read it, and a frozen baseline in place, the audit can finally be acted on. The measurements the baseline produces — which tools generate the most tokens, which turn is most expensive, which content category grows fastest, and how much of every request the model has already seen — say where the waste is. This change removes it.

The target is a reduction of at least 30% in tokens consumed over the benchmark task set, with the correctness rate falling by no more than 2 percentage points. Both halves matter equally: an optimization that truncates aggressively will cut tokens and quietly produce worse answers, and the benchmark exists precisely to catch that trade rather than to celebrate the first number.

## What Changes

- Tool results that exceed a configured size are truncated before they enter the conversation, with the truncation stated in the result so the model knows it is seeing part of something rather than all of it.
- The output of a shell command is compressed before it enters the conversation — noise filtered, repeated lines collapsed, long listings summarised — so that the agent pays for what the output means rather than for every line of it. Compression is stated in the result for the same reason truncation is: a summary the model mistakes for verbatim output is worse than no summary.
- Reading a file can be bounded to a range of lines, so answering a question about part of a file does not put the whole file into the context.
- Conversation history is compacted once it grows past a configured size, so a long-running chat stops resending its entire past on every turn.
- The stable part of each request — the agent's instructions and its skill index — is held byte-identical across calls, so a provider that reuses a repeated prefix can do so.
- The block of tool definitions sent on every call is reduced by removing redundancy, never capability: a tool whose behaviour is a special case of another's is no longer advertised separately, and argument descriptions that only restate the argument's name and type are dropped while those carrying a real constraint are kept.
- The agent's instruction text stops repeating what the tool definitions already say.
- Each optimization is measured on its own against the baseline, and the combination is measured too, so that a change which helps overall while hurting one task is visible rather than averaged away.

The specific set is chosen from what the baseline shows, not decided in advance. The seven above are the candidates; any that the measurements do not justify is dropped rather than implemented for its own sake, and the reason is recorded.

Shell-output compression is provided by RTK ("Rust Token Killer", https://github.com/rtk-ai/rtk), a single dependency-free Rust binary that intercepts a command's output and compresses it — filtering noise, grouping similar items, deduplicating repeated log lines, truncating in a way that preserves context — before the agent reads it. It claims up to 90% reduction of the bash output an agent reads, and is explicit that bash output is only part of input tokens and that its absolute token figures are approximate while its percentages are reliable.

Its measured effect on this task set is close to nothing: `execute_command` ran ten times across the whole baseline and produced 15 tokens of output in total, the largest single result being 8 bytes, so RTK's ceiling here is roughly 0.03% of the baseline's 48,845 input tokens. It is adopted anyway, on the same grounds as this change's own tool-result limit and bounded file reads: the benchmark points its tools at small, known targets, while `execute_command` in real use has no upper bound on what it can return. Keeping this change's own bounds because the benchmark under-represents them while rejecting RTK because the benchmark under-represents it would be the same argument used in both directions.

## Capabilities

### New Capabilities

- `context-management`: the rules governing what may enter a request and how large each part may be — tool-result limits, bounded file reads, history compaction, and prefix stability.

### Modified Capabilities

- `bot-orchestrator`: history-aware handling is amended so that a conversation past a configured size is sent compacted rather than in full.
- `sandbox-execution`: a tool result carries an indication when it was truncated.

The last three exist because the baseline shows where the tokens actually are, and it is not where the first four look. Measured across the 70 baseline calls, roughly 600 of every call's ~700 input tokens is a constant block — about 542 estimated tokens of tool definitions and ~60 of instruction text — resent unchanged on every call, while tool output is 2.4% and conversation history 0.5%. Reducing that block is the only thing on this task set that moves the measured number, because the provider reports the full prompt size regardless of what it reuses internally.

Every one of the three removes redundancy rather than information. Not advertising `spawn_subagent` costs nothing because `spawn_subagents` with one task does exactly what it did — it already implements it by calling it. Dropping `"path: Path to the file to read"` costs nothing because the argument is named `path` and typed `string`. Keeping `read_skill`'s `"Exact skill name, as shown in the skill index"` costs 8 tokens and buys a constraint the model cannot infer. The line between the two is whether the model loses anything it was using, and where that is uncertain the text stays.

## Impact

- New context-management module, and configuration for each limit.
- `src/tools/read-file.ts` — an optional line range.
- `src/sandbox/sandbox-executor.ts` — result truncation.
- `sandbox/Dockerfile` — the RTK binary added to the sandbox image, which currently carries only `coreutils`, `curl` and `ca-certificates` on `alpine:latest`. This puts a third-party compiled binary inside the boundary that contains model-chosen shell commands, where — unlike this change's own TypeScript bounds — it cannot be read in the dependency tree. That is a security decision, and design.md records it as one.
- `src/tools/execute-command.ts` — shell output routed through RTK.
- The sandbox image must be rebuilt (`npm run sandbox:build`) for the change to take effect; `scripts/check-sandbox-image.mjs` gates `npm run docker:up` on the image existing.
- `src/orchestrator.ts` — compaction at request assembly; the instruction prefix held stable.
- `src/skills/` — index rendering must stay byte-identical between calls.
- `src/tools/index.ts` — `spawn_subagent` is no longer registered for advertisement; `spawnSubagentTool` stays as the implementation `spawn_subagents` calls.
- `src/tools/*.ts` — argument descriptions that restate the schema removed; those carrying constraints kept.
- `src/system-instruction.ts` — instruction text no longer repeating what the tool definitions carry.
- `benchmark/` — no change. The task set is frozen; editing it would invalidate the baseline this change is measured against.
- `README.md` — each limit, its default, and the before/after result.
- `prices.json` — a price table must be configured before snapshots are taken, or every call records as unpriced and the before/after comparison reports a cost of zero on both sides. Ollama is local and incurs no real spend, so the figure is a proxy built from the rates of comparable hosted models, and the report must say so.
- **Sequencing**: land last — after `add-agent-benchmark` has recorded a baseline, and after `fix-context-attribution` and `adopt-standard-observability`. Without the baseline there is nothing to measure against and the 30% claim is unverifiable. `fix-context-attribution` must precede this change because the content-category and repeated-input figures it corrects are the figures this change uses to decide which optimizations are worth keeping.

## Non-goals

- Reducing what the agent can do. Every optimization is about not resending what the model already has, or not sending what was never needed — not about restricting capability.
- Hitting the target by degrading answers. The correctness gate is the constraint, not a formality.
