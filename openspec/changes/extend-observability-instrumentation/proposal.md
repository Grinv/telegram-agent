## Why

The agent records statistics, but not enough of them to answer the question they exist for: where do the tokens go, and what does a run cost?

What is recorded today, per LLM call: a model name, prompt and completion token counts, a latency, an ok flag, and a role. What is missing: when the call happened (only the message has a timestamp), which agent made it when several run in parallel, how many tokens were served from cache or spent on reasoning, and what any of it cost. There is no notion of cost anywhere in the codebase.

Per tool call the gap is worse. The `latency_ms` column exists and is always `0` — `runLoop` calls `recordToolCall` without ever passing a duration, so every tool in the database appears to take no time. Result size is recorded in characters, which cannot be compared against the token counts recorded for LLM calls.

Two questions cannot be asked at all: which kind of content is filling the context window, and how much of each request the model has already seen. Both are needed before any optimization can be chosen on evidence rather than by guessing.

## What Changes

- Each LLM call additionally records its own timestamp, the identity of the agent that made it, cached and reasoning token counts where the provider reports them, and an estimated cost.
- Existing token, latency and turn columns are renamed to the vocabulary used everywhere else in this work (`input_tokens`, `output_tokens`, `latency`, `turn_number`), so the same concept is not called two things in two tables.
- Each tool call records a real duration instead of zero, plus the size of its arguments, the size of its result, and that result's size in tokens.
- A configurable price table turns token counts into an estimated cost per call, stored at the time of the call.
- Each LLM call records how its input divides across content categories — the agent's instructions, the user's request, the conversation so far, and tool output — so it becomes possible to see which category grows fastest.
- Each LLM call records how much of its input the model had already been sent in an earlier call of the same task, and how much was new.
- Parallel sub-agents become individually identifiable, so their calls are no longer indistinguishable from each other.

Nothing here changes what the agent does. Every addition is measurement.

## Capabilities

### Modified Capabilities

- `agent-stats`: extends the per-LLM-call and per-tool-call recording requirements with the fields above, adds cost estimation, context-category attribution, and repeated-input measurement, and fixes the requirement gap that let tool duration go unrecorded.

## Impact

- `src/stats/migrations.ts` — a new migration renaming and adding columns. `schema.sql` stays as written: it is migration v1, and the project's convention (README) is to append migrations rather than edit it.
- `src/stats/types.ts`, `src/stats/sqlite-recorder.ts` — the widened stat payloads and their inserts.
- `src/stats/reporter.ts` — queries updated to the renamed columns.
- New pricing configuration, read at startup.
- `src/orchestrator.ts` — measures tool-call duration and supplies the context-category and repeated-input measurements at the point where the request is assembled, which is the only place that knows what each message is.
- `src/tools/spawn-subagent.ts` — passes a distinct agent identity per sub-agent.
- `.env.example`, `README.md` — the price table and the new columns.
- Existing databases are upgraded in place, keeping their rows. Reports covering data from before and after the change will show zero for columns that did not exist then; that must be read as "not recorded", not as "measured zero".
