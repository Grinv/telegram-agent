## Why

Everything the agent knows about its own cost is hand-written. `src/stats/` holds a bespoke SQLite recorder (`sqlite-recorder.ts`), a report generator (`reporter.ts`), a query layer (`dashboard-queries.ts`), a view renderer (`dashboard-views.ts`) and four CLI entry points (`summary-cli.ts`, `timeline-cli.ts`, `analysis-cli.ts`, `reporter-cli.ts`) that render Markdown into `data/*.md`. The `agent-stats` capability carries fifteen requirements describing behaviour — per-call token recording, cost estimation, agent attribution, timeline and summary views, migrations — that established tools provide off the shelf: Langfuse, LangSmith, Helicone, OpenLLMetry, and OpenTelemetry itself.

That layer exists because `openspec/config.yaml` instructs: "Avoid third-party SDKs/libraries where a Node built-in covers it, to limit supply-chain surface." The rule was applied, but its cost was never weighed against what it bought. Today the project has one runtime dependency (`undici`) and 9 packages in `node_modules` — an unusually small attack surface, and a genuine asset for a bot that executes model-chosen shell commands. It also has roughly a thousand lines of observability code to maintain, no trace UI, no latency percentiles, no retention policy, and a reporting surface that only answers the questions someone thought to write a query for.

This change makes that trade-off explicit and decides it deliberately rather than by default.

## What Changes

- The agent emits **OpenTelemetry traces** for its work: a span per handled message, a child span per LLM call, a child span per tool call, carrying the attributes already recorded today — model, input/output/cached/reasoning tokens, latency, estimated cost, turn number, agent identity, tool name, input/output size, duration — under OpenTelemetry's GenAI semantic conventions where they exist.
- Traces are exported over **OTLP to an endpoint the operator configures**. With no endpoint configured, nothing is exported and no collector is required — the agent runs exactly as it does now. This keeps the isolated and microVM deployments unaffected unless their operator opts in.
- **The two custom measurements survive**, because no external tool computes them: `context-categories.ts` (splitting a call's input tokens across instruction, tool definitions, user request, conversation and tool output) and `repeated-input.ts` (how much of a request the model already saw on the previous call). They are computed as they are and carried as span attributes; `fix-context-attribution` lands first, so the spans carry the corrected attribution from the start.
- **The local SQLite store stays** as the source of truth the benchmark reads. `benchmark/runner.ts` queries that database directly to attribute per-execution tokens, cost, turns and tool calls; making the benchmark depend on an external trace backend would make a frozen, reproducible baseline depend on a service being up.
- **Nothing existing is removed.** The export is purely additive, and the honest reason is that export is off by default: retiring `timeline-cli.ts` because a trace viewer does it better would leave the default deployment — the one with no backend running — with no timeline at all. The four Markdown views keep working exactly as they do now.

  This bounds what the change is worth, and the bound should be stated plainly rather than discovered later. It buys **portability, not deletion**: the roughly thousand lines in `src/stats/` still need maintaining. What changes is where the *next* question goes. Today "what is the p95 latency per model" means writing another query and another view; with traces exported, it means opening whatever backend the operator runs. The saving is future work avoided, not current work removed.
- **`openspec/config.yaml`'s supply-chain constraint is amended** to record the exception this change creates, so the next reader is not left to guess whether the rule still holds. A rule that has been silently broken once is worse than a rule with a stated exception.
- **BREAKING**: none. No existing command, view, database column or default behaviour changes.

## Capabilities

### Modified Capabilities

- `agent-stats`: recorded statistics gain a standard export path — the same measurements, emitted as OpenTelemetry spans to an operator-configured OTLP endpoint, in addition to the local database. No existing requirement is removed; the existing views and the local database keep their current behaviour. The requirement that recording never blocks or fails message handling is extended to cover an unreachable or slow export endpoint.

## Impact

- `package.json` — the OpenTelemetry SDK, exporter and API packages. This is the substance of the trade-off: the footprint moves from 9 packages to the dozens the OTel SDK brings transitively. The actual resulting count is measured as part of the work, not estimated here, and is the number on which the decision should be re-checked.
- `src/stats/` — a new exporter alongside `SqliteStatsRecorder`, both driven through the existing `StatsRecorder` interface so the orchestrator is unchanged. Existing modules and CLI entry points are untouched.
- `src/orchestrator.ts` — unchanged in behaviour; it already calls `statsRecorder?.recordLlmCall` / `recordToolCall` and needs no new call sites.
- `benchmark/` — unchanged. The task set is frozen and the runner keeps reading the local database. This change must not alter benchmark figures.
- `docker-compose.yml` — an optional, opt-in collector/backend service, not started by default.
- `.env.example`, `README.md`, `DEPLOYMENT.md` — the new endpoint setting, its default (unset = no export), and what an operator gains by pointing it somewhere.
- `openspec/config.yaml` — the amended supply-chain constraint.
- **Sequencing**: land second — after `fix-context-attribution`, before `add-token-optimizations`. The attribution fix precedes it so the exported spans carry corrected figures from the start. This change is additive: it alters neither what is sent to the model nor what the SQLite recorder writes or when, so the frozen baseline in `benchmark/baseline.md` stays valid across it and needs no re-recording — a claim this change verifies by re-running the benchmark against that baseline rather than asserting it.

## Non-goals

- Removing the benchmark, its frozen task set, or its baseline.
- Sending prompts, replies or any user content to a third-party service. Whatever backend an operator points the exporter at is theirs to run; the change ships no default that leaves the machine.
- Claiming a cache hit rate. Measured on the running Ollama on 2026-09-04: `/api/chat` reports no cached-token count, and `prompt_eval_count` returns the full prompt size even for a byte-identical repeat — two identical requests both reported 2617 prompt tokens. No backend, bespoke or off-the-shelf, can display a cache hit rate on this provider; the `cached_tokens` and `reasoning_tokens` fields stay unpopulated and must be shown as unavailable rather than as zero.
