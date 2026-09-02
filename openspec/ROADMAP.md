# Change roadmap

The order the pending changes are meant to be implemented in, and why that order
is what it is. Each change also carries its own sequencing note; this file is the
overview. Delete a row once its change is archived.

The two drivers behind the ordering: the agent must be feature-complete before a
token-consumption baseline is taken (otherwise the baseline misses the largest
source of growth), and the baseline must exist before anything is optimized
(otherwise no claim about the optimization is checkable).

## Phase 1 — correctness and features

| # | Change | Why here |
| --- | --- | --- |
| 1 | `fix-ollama-message-mapping` | Two defects in one function; everything downstream inherits them. Must precede `add-agent-skills`, which rewrites the same code. |
| 2 | `fix-telegram-message-limit` | Long replies are delivered as failures yet recorded as successes, so measured success rate is inflated. Must precede any baseline, and precede `add-chat-context-history`, which keys persistence off successful delivery. |
| 3 | `add-sandbox-egress` | Unblocks skills that call an HTTP API from the command line. Independent of 1–2. |
| 4 | `add-agent-skills` | Introduces the system instruction that later changes depend on. After 1. |
| 5 | `add-chat-context-history` | Conversation history and `/new`. After 2 and 4. |

## Phase 2 — measurement

| # | Change | Why here |
| --- | --- | --- |
| 6 | `extend-observability-instrumentation` | Records where tokens go. After 4 and 5, or two of its four content categories are permanently empty. |
| 7 | `add-observability-dashboard` | Reads back what 6 records. After 6. |
| 8 | `add-agent-benchmark` | Frozen task set and the baseline snapshot. After all of 1–7. |

## Phase 3 — optimization

| # | Change | Why here |
| --- | --- | --- |
| 9 | `add-token-optimizations` | Measured against 8's baseline. Last. |

## Out of band

| Change | Note |
| --- | --- |
| `add-microvm-isolation` | Deployment boundary; touches no source under `src/`. Can land at any point without affecting the others. Its findings do bound the residual risk that `add-sandbox-egress` documents, so read them together. |
