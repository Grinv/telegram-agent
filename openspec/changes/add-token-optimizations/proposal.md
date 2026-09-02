## Why

With the instrumentation, the views that read it, and a frozen baseline in place, the audit can finally be acted on. The measurements the baseline produces — which tools generate the most tokens, which turn is most expensive, which content category grows fastest, and how much of every request the model has already seen — say where the waste is. This change removes it.

The target is a reduction of at least 30% in tokens consumed over the benchmark task set, with the correctness rate falling by no more than 2 percentage points. Both halves matter equally: an optimization that truncates aggressively will cut tokens and quietly produce worse answers, and the benchmark exists precisely to catch that trade rather than to celebrate the first number.

## What Changes

- Tool results that exceed a configured size are truncated before they enter the conversation, with the truncation stated in the result so the model knows it is seeing part of something rather than all of it.
- Reading a file can be bounded to a range of lines, so answering a question about part of a file does not put the whole file into the context.
- Conversation history is compacted once it grows past a configured size, so a long-running chat stops resending its entire past on every turn.
- The stable part of each request — the agent's instructions and its skill index — is held byte-identical across calls, so a provider that reuses a repeated prefix can do so.
- Each optimization is measured on its own against the baseline, and the combination is measured too, so that a change which helps overall while hurting one task is visible rather than averaged away.

The specific set is chosen from what the baseline shows, not decided in advance. The four above are the candidates the instrumentation was built to evaluate; any that the measurements do not justify is dropped rather than implemented for its own sake, and the reason is recorded.

## Capabilities

### New Capabilities

- `context-management`: the rules governing what may enter a request and how large each part may be — tool-result limits, bounded file reads, history compaction, and prefix stability.

### Modified Capabilities

- `bot-orchestrator`: history-aware handling is amended so that a conversation past a configured size is sent compacted rather than in full.
- `sandbox-execution`: a tool result carries an indication when it was truncated.

## Impact

- New context-management module, and configuration for each limit.
- `src/tools/read-file.ts` — an optional line range.
- `src/sandbox/sandbox-executor.ts` — result truncation.
- `src/orchestrator.ts` — compaction at request assembly; the instruction prefix held stable.
- `src/skills/` — index rendering must stay byte-identical between calls.
- `benchmark/` — no change. The task set is frozen; editing it would invalidate the baseline this change is measured against.
- `README.md` — each limit, its default, and the before/after result.
- **Sequencing**: land last, after `add-agent-benchmark` has recorded a baseline. Without that baseline there is nothing to measure against and the 30% claim is unverifiable.

## Non-goals

- Reducing what the agent can do. Every optimization is about not resending what the model already has, or not sending what was never needed — not about restricting capability.
- Hitting the target by degrading answers. The correctness gate is the constraint, not a formality.
