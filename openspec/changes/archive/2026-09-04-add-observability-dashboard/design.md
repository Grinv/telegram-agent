## Context

Written after implementation, to record the decisions actually made (see `tasks.md` for the checked-off breakdown and `src/stats/dashboard-queries.ts` / `dashboard-views.ts` for the code). See `proposal.md` for motivation. The three views read the columns `extend-observability-instrumentation` added to `llm_calls` (timestamp, cost, category attribution, repeated-input) and `tool_calls` (output tokens); no schema change was needed.

## Goals / Non-Goals

**Goals:**
- Three read-only views (summary, timeline, analysis) as pure query functions over an already-migrated `DatabaseSync`, separable from rendering so each is unit-testable without producing text.
- Reuse the existing `StatsReporter`/`reporter-cli.ts` pattern (open → migrate → render → write Markdown under `data/`) rather than introducing a second delivery mechanism.

**Non-Goals:** see proposal.md - Non-goals (no hosted dashboard, no live streaming).

## Decisions

**Query layer separate from rendering** (`dashboard-queries.ts` vs. `dashboard-views.ts`). Each query function takes an open `DatabaseSync` and returns a typed result (or `null` for "no data"); rendering is a pure `(stats) => string` function. This is what let task 1.2's fixture tests assert exact numbers without parsing Markdown. Alternative considered: one file mixing SQL and string-building per view, matching how `reporter.ts` currently does it — rejected because the tasks explicitly call for unit-testing queries "without producing text."

**One tool-token-share computation, reused by both views.** The spec text differs slightly between the two requirements ("share of total tokens" in Summary, "share of generated tokens" in Analysis), but both describe the same figure: `tool_calls.output_tokens` summed per `tool_name`, ranked, each row's share of the total across all tools. A single `toolTokenShares(db)` function backs both views rather than two near-duplicate queries, so a ranking change only has one place to update.

**Cache hit rate scoped to `usage_detail_reported = 1`.** Computed as `SUM(cached_tokens) / SUM(input_tokens)` restricted to calls where the provider actually reported usage detail; `null` when no call in scope did. This reuses the flag `SqliteStatsRecorder` already sets per call rather than inferring "reported vs. not" from whether `cached_tokens` is zero, which would conflate a real 0%-cache-hit call with one that was never asked.

**Cost's "partial" flag reuses the existing `priced` column instead of a new migration check.** A row lands on `priced = 0` both when its model has no configured price and when it predates cost tracking (migration default). Both cases mean "don't read this total as complete spend," so one boolean check does double duty and `estimatedCost` never has to special-case old rows — their `estimated_cost` default of `0` is already the correct contribution to the sum.

**Category and repeated-input aggregates use `timestamp IS NOT NULL` as the migration-default filter.** These two fields were added in the same migration as `timestamp` (or later); a row without a `timestamp` unambiguously predates them, so it's excluded from `SUM(...)` and counted into an `excludedRows` field the view renders as a note ("N call(s) recorded before X existed are excluded"). Alternative considered: a dedicated "reported" flag per field, mirroring `usage_detail_reported` — rejected as unnecessary schema growth when `timestamp` already draws the same line for every field introduced from that migration onward.

**Most-expensive-turn is an unfiltered `MAX(input_tokens)`.** `input_tokens` (originally `prompt_tokens`) has existed since schema v1 — it's a rename, not a migration default — so it needs no exclusion.

**A "task" is a `messages` row.** There's no separate tasks table; one `messages` row is one full think → act → observe loop, so the timeline view's identifier is `messages.id` and turns are that message's `llm_calls` ordered by `turn_number`.

**Rendering writes Markdown under `data/`, one file per view, mirroring `stats:report`.** `StatsReporter` gained `generateSummary`/`generateTimeline`/`generateAnalysis` alongside the untouched `generateReport`, sharing a private `withDb` helper for the open/migrate/write-file boilerplate. Three new CLI entrypoints (`summary-cli.ts`, `timeline-cli.ts`, `analysis-cli.ts`) follow `reporter-cli.ts`'s one-file-per-command convention rather than a single subcommand-dispatching CLI, since that's the existing pattern for `stats:report` and keeps each `package.json` script a direct `node --import tsx <file>` with no argument-parsing library.

**Tool calls with no `llm_call_id` are omitted from the timeline.** `tool_calls.llm_call_id` is nullable (a tool call can be recorded before any LLM call), and the timeline can't attribute an unlinked row to a turn. In practice `SqliteStatsRecorder` always has a `lastLlmCallId` by the time it records a tool call in the normal think → act → observe flow, so this only matters for malformed/legacy data.

**Empty `tool_name` renders as `(unnamed tool)`.** Found while checking the shipped views against the real `data/stats.db` (task 7.2): a few pre-existing `tool_calls` rows (from before this change, unrelated to it) have `tool_name = ''`, which rendered as a blank table cell. Fixed as a rendering-only defensive case, not a new requirement — the underlying query and figures were already correct; only the empty-string display was confusing.

## Risks / Trade-offs

- Tool token shares are built on `estimateTokens` (character-count-based, ~4 chars/token; see `src/stats/token-estimate.ts`), not real tokenization, because tool output isn't tokenized by any provider in use. → The ranking and shares are relative/comparative, not exact counts; this is inherited from the instrumentation change, not introduced here.
- The analysis view's category breakdown (scaled proportionally to each call's reported `input_tokens`) and its repeated-vs-new breakdown (an independent character-based estimate against the previous call's message list) don't sum to each other or necessarily to the same total. → Both figures are individually accounted-for (categories always sum to exactly the input tokens they describe — task 4.3/verified against real data), but a reader comparing the two sections' totals side by side could be misled into expecting them to reconcile. No mitigation implemented; noted here since it wasn't obvious until checked against real data.
- A cost total of `$0.000000 (partial — ...)` (real-world case: no price table configured) is easy to misread at a glance as "this ran free" rather than "cost unknown." → The `(partial — ...)` suffix is exactly the mitigation the "unavailable figures" requirement calls for; no stronger UI is in scope for a Markdown-file CLI output.

## Migration Plan

None. Purely additive, read-only code against the schema `extend-observability-instrumentation` already migrated; no new tables/columns, no changes to write paths, and `generateReport`'s existing output is verified unchanged (task 6.2). Nothing to roll back beyond reverting the new files if needed.
