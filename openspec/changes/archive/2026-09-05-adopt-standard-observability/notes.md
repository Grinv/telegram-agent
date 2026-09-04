Implementation notes recorded while applying this change (see tasks.md).

## 1.1 — Dependency footprint measured

Before (git HEAD, no OTel packages installed):
- `node_modules` packages: **9**
- runtime dependencies in `package.json`: **1** (`undici`)

After `npm install --save @opentelemetry/api @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions`:
- `node_modules` packages: **21** (npm reported "added 12 packages")
- runtime dependencies in `package.json`: **6** (`undici` + 5 `@opentelemetry/*` packages; these pull in `@opentelemetry/core`, `@opentelemetry/otlp-exporter-base`, `@opentelemetry/otlp-transformer`, `@opentelemetry/sdk-trace`, `@opentelemetry/sdk-logs`, `@opentelemetry/sdk-metrics`, `@opentelemetry/api-logs` transitively — the OTLP-transformer package pulls in the logs/metrics SDKs even though only tracing is used here)

This is far short of "dozens" — the design's risk section anticipated a worse outcome. `@opentelemetry/sdk-trace-node` (which adds Node-specific auto-instrumentation plumbing) and the gRPC OTLP exporter (which needs `@grpc/grpc-js`) were deliberately not installed; `sdk-trace-base` plus the HTTP OTLP exporter cover everything this change needs and keep the footprint at 12 added packages.

## 1.2 — Decision to proceed

12 added packages (9 → 21 total, 1 → 6 runtime dependencies) against the supply-chain constraint in `openspec/config.yaml` ("avoid third-party SDKs/libraries where a Node built-in covers it"): **proceed**.

Reasoning: the constraint's purpose is limiting attack surface for a bot that executes model-chosen shell commands (see proposal.md — Why). All added packages are `@opentelemetry/*` scoped, maintained by the OpenTelemetry project (CNCF), carry no native bindings or install scripts, and the count (12) is an order of magnitude below what the design's risk section treated as the threshold for reconsidering ("dozens ... transitively"). There is no Node built-in that covers distributed tracing/OTLP export, so the constraint's own test ("avoid third-party ... where a Node built-in covers it") does not apply — a built-in does not exist. Proceeding; `openspec/config.yaml` is amended in task 7.4 to record this exception.

## 7.5 — This change is additive

Nothing existing was removed, renamed, or changed in default behaviour:

- `src/stats/sqlite-recorder.ts`, `reporter.ts`, `dashboard-queries.ts`, `dashboard-views.ts` and all four CLI entry points (`stats:report`, `stats:summary`, `stats:timeline`, `stats:analysis`) are untouched and behave exactly as before.
- `src/orchestrator.ts` is untouched (see task 4.1's verify: `git diff src/orchestrator.ts` shows only the pre-existing, already-uncommitted `fix-context-attribution` diff from before this change started — nothing from this change's own work).
- The stats database schema, `STATS_DB_PATH`, and every existing env var's default are unchanged.
- With `OTEL_EXPORTER_OTLP_ENDPOINT` unset (the shipped default), the agent's behaviour, dependencies-in-use, and every recorded row are identical to before this change existed.

## 6.1 — Benchmark re-run against baseline

Ran the full benchmark (`docker compose run --rm -e BENCHMARK_MODEL=qwen2.5 -e BENCHMARK_REPETITIONS=5 benchmark node --import tsx benchmark/run.ts after-observability`, matching baseline's recorded conditions exactly) with `OTEL_EXPORTER_OTLP_ENDPOINT` unset (export disabled), then compared against `data/benchmark-snapshots/baseline.json`:

- 30/30 executions correct (100%), matching baseline.
- Turns and tool-call counts identical across all 30 executions (task × repetition).
- Tokens: -2 total (50303 → 50301, -0.0%), entirely on one repetition of `subagent-three-sums`; every other task's tokens matched exactly. A ±few-token difference on one execution of a live (non-stub) LLM run is the same order of variance `benchmark/baseline.md` itself documents as expected under real inference, not something attributable to this change — the composite recorder does not alter what's sent to the model or what the SQLite recorder writes (verified directly in task 4.4's test).
- Estimated cost delta: 0.
- `benchmark:compare`'s `regressedTasks`: none.

Full comparison: `data/benchmark-compare-baseline-vs-after-observability.md` (gitignored, like all of `data/`).

**What this change saves:** nothing, today, for a deployment that never sets the endpoint — that's the point of "additive" (see proposal.md — What Changes). What it buys is *optionality*: an operator who wants a trace UI, latency percentiles, or a retention policy no longer needs a bespoke view written for the question — they point `OTEL_EXPORTER_OTLP_ENDPOINT` at a backend and get it from that backend instead. The ~1,000 lines in `src/stats/` still exist and still need maintaining; this change does not reduce that maintenance burden, it adds a second, optional path alongside it.
