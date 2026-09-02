## Why

Once the instrumentation change lands, the database holds everything needed to answer where the tokens go — and nothing reads it that way. The existing report renders five tables: token totals per model, tokens per role, latency per model, an overall success rate, and a tool-usage summary. It answers "what happened in aggregate" and cannot answer any of the questions the audit exists to settle:

- What does an average task cost, in tokens, turns and tool calls?
- Which tools produce the largest share of the tokens?
- Which turn of a task is the most expensive, and why?
- Which kind of content is growing fastest — conversation, tool output, instructions?
- How much of what we send has the model already seen?

Nor can it show a single run. Diagnosing why one task cost what it did means reading the raw tables by hand, because there is no view that walks one task turn by turn.

Without those views, choosing optimizations means guessing at which of them will pay.

## What Changes

- A summary view over all recorded activity: tasks completed, input/output/cached token totals, estimated cost, per-task averages, and the share of tokens attributable to each tool.
- A timeline view of one task: each turn in order, what the LLM call cost, and what each tool call returned — so a single expensive run can be read directly.
- An analysis view answering the token-consumption questions: the tools ranked by token share, the most expensive turn, the input broken down by content category, and how much input was repeated rather than new.
- Reports state when a number is unavailable rather than presenting a placeholder as a measurement — in particular, a cache hit rate is shown only where the provider actually reported cached tokens.

Nothing here changes what the agent does or what is recorded. This change only reads.

## Capabilities

### Modified Capabilities

- `agent-stats`: extends the reporting requirement from a single aggregate report to three views — summary, single-task timeline, and consumption analysis — and requires unavailable figures to be reported as unavailable.

## Impact

- `src/stats/reporter.ts` — extended, or split, to produce the additional views.
- `src/stats/reporter-cli.ts` and `package.json` — entry points for the timeline and analysis views alongside the existing report.
- `README.md` — how to read each view.
- No schema change: every figure comes from columns the instrumentation change adds. **Sequencing: land `extend-observability-instrumentation` first**; without it there is no timestamp per call, no cost, no category attribution and no repeated-input measurement to report, and tool durations are all zero.
- No change to `src/orchestrator.ts` or anything under `src/tools/`.

## Non-goals

- A hosted dashboard. Output is rendered for a terminal and as Markdown, matching how the existing report is consumed. Pointing a visualisation tool at the database stays possible and stays optional, as the README already notes.
- Live streaming. These views read what has been recorded; they do not follow a run in progress.
