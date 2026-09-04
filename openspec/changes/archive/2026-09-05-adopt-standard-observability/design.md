## Context

See proposal.md — Why. Three facts in the repository shape the approach.

`src/orchestrator.ts` already funnels every unit of work through one interface: `deps.statsRecorder?.recordMessage(...)`, `recordLlmCall(...)` and `recordToolCall(...)` are called from `runLoop` and `createMessageHandler`, and `StatsRecorder` is defined in `src/stats/types.ts`. Nothing new has to be threaded through the orchestrator to observe a call — the observation points exist.

`benchmark/runner.ts` reads per-execution figures back out of the stats SQLite database after each benchmark task runs. The benchmark's baseline (`benchmark/baseline.md`, from `data/benchmark-snapshots/baseline.json`) is frozen and is the reference point another in-flight change measures itself against. Anything that changes what the database contains, or when it contains it, changes those numbers.

The default deployment (`docker-compose.yml`) is two services, and an alternative microVM deployment described in `DEPLOYMENT.md` keeps the Telegram token outside the boundary entirely. A design that requires a third service to be running in order for the agent to work would be rejected by both.

## Goals / Non-Goals

**Goals:**
- One place computes each measurement; both the local database and the export read it from there, so the two can never disagree.
- Adding the exporter cannot change a benchmark figure.
- The agent runs, and records locally, with no collector present.

**Non-Goals:**
- Choosing which backend the operator runs. The design ends at the OTLP endpoint.
- Replacing the local database or any existing view (see proposal.md — What Changes).
- Reworking how the derived measurements are computed. `context-categories.ts` and `repeated-input.ts` are used as they are.

## Decisions

**OpenTelemetry with OTLP export, rather than a vendor SDK.** The alternatives were Langfuse's TypeScript SDK, LangSmith, and Helicone.

The decisive property is that OTLP is an ingestion format several backends accept, Langfuse among them, whereas a vendor SDK commits the code to one destination. Instrumenting against OpenTelemetry therefore does not exclude Langfuse — it leaves it as one of the destinations an operator may point at — while instrumenting against Langfuse's SDK would exclude Grafana/Tempo, Jaeger and the rest. Choosing the option that preserves the other options costs nothing here, because the spans carry the same attributes either way.

The second property is that OpenTelemetry imposes no infrastructure. With no endpoint configured, the SDK emits nothing and nothing needs to run. Langfuse self-hosted requires Postgres, ClickHouse, Redis, a web service and a worker before it shows a single figure — an infrastructure footprint heavier than the agent it observes (`docker-compose.yml` is two services).

What this loses, and it is a real loss: OpenTelemetry ships no user interface. Langfuse would have given a purpose-built LLM-agent UI — traces, sessions, cost — the moment it was running, whereas OTLP export gives nothing visible until the operator stands up a backend. This design accepts that the first-run experience is worse in exchange for not binding the project to one vendor and not mandating five services. If the priority were "a dashboard today", Langfuse would be the right answer instead.

LangSmith was rejected because it is a proprietary hosted service whose self-hosted form is enterprise-only: using it means sending prompts and replies to a third party, which contradicts the isolation posture the deployment is built around. Helicone was rejected because it works as a proxy in front of the model provider — a hop in front of a local Ollama on the same Docker network buys nothing, and its hosted form moves traffic off the machine for the same reason LangSmith was rejected.

**A second `StatsRecorder` implementation, composed with the existing one, rather than export calls added to the orchestrator.** The interface already exists and the orchestrator already calls it at exactly the three points that need observing. A composite recorder that forwards each call to both the SQLite recorder and the exporter keeps `src/orchestrator.ts` untouched, keeps each recorder independently testable with no OTel SDK involved in the SQLite tests, and makes "export is off" a matter of composing one recorder instead of two.

The alternative — instrumenting inside `sqlite-recorder.ts` — was rejected because it welds the two together: the exporter would then be unable to run without the database, and a test of either would drag in the other.

**The derived measurements stay where they are.** `measureContextStats` in `src/orchestrator.ts` already computes the category split and repeated-input figures and passes them into `recordLlmCall`. The exporter reads them from the same recorded payload rather than recomputing them. Recomputing would risk the database and the trace disagreeing about the same call, which is the one failure mode that would make both untrustworthy.

**The exporter is span-per-unit, matching the interface's three calls.** A message span is opened when `recordMessage` first sees the message and closed when it sees the message's completion; LLM-call and tool-call spans are children of it. Sub-agent LLM calls nest under the tool-call span that spawned them, which the recorded `agentId` and `role` fields already distinguish (`src/stats/types.ts`). This is the structure the spec requires, and it is the structure that makes a trace answer "what did this message cost" without a query.

**Export failures are swallowed and rate-limited in logging.** The existing requirement is that stats recording never fails message handling; a network export has more ways to fail than a local write, and a destination that is down stays down for many messages. Logging each failed span would turn one outage into a flooded log. The design logs the transition into and out of a failing state, not each failure.

**Batched, non-blocking export.** Spans are queued and flushed in batches by the SDK's batch processor rather than sent per span, so a slow endpoint cannot serialise itself into message handling. The queue is bounded: when it fills, spans are dropped rather than allowed to grow without limit, because dropping observability data is always preferable to consuming memory in the process that serves users.

## Risks / Trade-offs

**The dependency footprint is the whole cost of this change, and it is not small.** The project has one runtime dependency and 9 packages installed; the OpenTelemetry SDK, the OTLP exporter and the API bring dozens transitively into a bot that executes model-chosen shell commands. → The count is measured as the first implementation task, before any code depends on it, and reported as a number rather than an impression. If it comes in far worse than expected, the decision to adopt is worth revisiting at that point rather than after the work is done — that is why it is measured first. The mitigating structure is that the exporter is a separate module behind the existing interface, so abandoning it removes one file and one dependency block rather than unpicking the orchestrator.

**The exporter could change benchmark figures.** The benchmark reads tokens, cost, turns and tool calls from the stats database, and its baseline is frozen and in use by another change. → The composite recorder must not alter what the SQLite recorder writes or when. The verification is empirical, not argumentative: run the benchmark with export disabled and confirm the figures match the existing baseline exactly before anything else is accepted.

**Instrumenting the process that serves users can degrade it.** A batch processor holds a queue and a timer inside the bot process. → Bounded queue, batched flush, and a check that with no endpoint configured the SDK is not started at all — not started and idle, but not started.

**A trace carries prompts if it is allowed to.** The local recorder already honours `STATS_STORE_PROMPTS` for prompt text. An exporter that ignored that setting would send to a network destination exactly the content the operator asked not to store locally. → The exporter must honour the same setting, and its default must be the more private reading of it. This is the risk most likely to be got wrong quietly, because nothing fails when it is wrong.

**"Ollama reports no cache statistics" does not become true just because the backend is standard.** Measured against the running Ollama on 2026-09-04: two byte-identical requests both reported 2617 prompt tokens, and no cached-token count was returned. → The cached-token and reasoning-token attributes are omitted rather than exported as zero (see specs/agent-stats/spec.md), so a backend cannot render a 0% cache hit rate that looks like a measurement.

## Migration Plan

No data migration. The stats database schema is unchanged and no existing view, command or default behaviour changes.

Deployment is opt-in in one direction only: an operator sets the export endpoint and, if they want somewhere for it to go, starts the optional collector service. Rollback is unsetting the endpoint — the agent then behaves exactly as before, with no collector required and nothing exported.

## Open Questions

- Which OTLP transport to configure by default when an endpoint *is* set (HTTP/protobuf against gRPC). Both are supported by every backend under consideration; the choice affects one dependency and one configuration line, and changes neither the spans nor the requirements.
