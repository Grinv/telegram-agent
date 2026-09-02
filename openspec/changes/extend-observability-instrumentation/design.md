## Context

See proposal.md — Why. The state this builds on:

- `src/stats/schema.sql` defines three tables. `llm_calls` has `message_id`, `call_index`, `role`, `model`, `prompt_tokens`, `completion_tokens`, `latency_ms`, `ok`. `tool_calls` has `message_id`, `llm_call_id`, `tool_name`, `args_json`, `latency_ms`, `ok`, `result_len`. Only `messages` carries a timestamp.
- Migrations are versioned with `PRAGMA user_version` (`src/stats/migrations.ts`), applied by both the recorder and the reporter on open, each in its own transaction. `schema.sql` is migration v1 and is not edited; changes are appended as new entries.
- `SqliteStatsRecorder` attributes LLM and tool calls to `currentPending`, the most recently started message, because the stat payloads carry no task id.
- `runLoop` calls `recordToolCall({ iteration, toolCalls, results })`. `ToolCallStats` declares an optional `durationMs`, and nothing ever passes it, so `latency_ms` is written as `0` on every row.
- The Ollama connector reports `prompt_eval_count` and `eval_count` only. It reports nothing resembling a cached-token or reasoning-token count.

## Goals / Non-Goals

**Goals:**
- Record enough to identify where tokens go, without yet changing anything about how they are spent.
- Keep existing databases usable — upgraded in place, rows preserved.
- Make "not measured" distinguishable from "measured zero" in reports.

**Non-Goals:**
- Rendering any of this. The dashboard and the token-eater analysis are a separate change that reads these columns.
- Reducing token consumption. That is the optimization change, which must be measured against a baseline collected with this instrumentation already in place.
- Retrofitting values onto rows recorded before this change.

## Decisions

**Rename the existing columns rather than add parallel ones.** `prompt_tokens`/`completion_tokens`/`latency_ms`/`call_index` become `input_tokens`/`output_tokens`/`latency`/`turn_number`. The reason is not tidiness: this change adds `cached_tokens` and `reasoning_tokens`, and leaving `prompt_tokens` beside them would give one table two vocabularies for the same concept, which is how a reporting query ends up summing the wrong pair. SQLite supports `ALTER TABLE ... RENAME COLUMN` and preserves the data, verified against the `node:sqlite` build in use (SQLite 3.51.2). Rename and additions go in one migration, so a database is never half-converted.

`tool_calls.latency_ms` becomes `duration` and `result_len` becomes `output_size`, following the same vocabulary. That leaves two tables naming elapsed time differently — `latency` for an LLM call, `duration` for a tool call — which is deliberate: it is the distinction the reports draw, and collapsing them would lose it.

**Reuse `message_id` as the task identifier; add `agent_id` as a new column.** A task is the handling of one message, which `messages.id` already identifies; adding a second column for the same thing would invite the two to disagree. Agent identity is genuinely new: `role` says *what kind* of agent, and cannot separate three sub-agents running at once. `agent_id` carries the specific one (`main`, `classifier`, `subagent-1`…), with `role` kept for grouping.

**Timestamps are nullable on the new column.** `ALTER TABLE ... ADD COLUMN` cannot add a `NOT NULL` column without a constant default, and there is no honest constant for "when did this pre-existing call happen". Rows recorded before this change keep a null timestamp, which reads correctly as unknown. The numeric additions take `DEFAULT 0`, since zero is the correct starting value for a counter.

**Store the computed cost, not just the inputs to it.** Cost could be derived at report time from tokens and a current price table. It is stored instead, because the price table will change and a report of last month's spend should not silently reprice itself. The trade-off — a price correction cannot be applied retroactively — is the intended behaviour.

**An unpriced model records zero cost and is reportable as unpriced.** With a local provider the honest price is zero, and a zero that means "free" is indistinguishable from a zero that means "we forgot to configure this model". The recorder therefore has to make the distinction visible; a report that sums cost across models must be able to say how much of its total came from unpriced models.

Note the consequence for the local setup: with Ollama, real spend is zero, so the price table must be populated with the rates of comparable hosted models for cost figures to mean anything. That makes the numbers a proxy for spend rather than spend itself, which is fine for the comparison this exists to support — a 30% reduction is 30% at any price — but the reports must not imply money actually changed hands.

**Category attribution is computed where the request is assembled, not inferred later.** Only the code building the message list knows which message is an instruction, which is the user's turn, which is prior conversation and which is tool output. Reconstructing that afterwards from stored rows would mean re-deriving intent from shape, and would break the moment a message type is added. The attribution is therefore produced at assembly time and passed into the recorder with the call.

**Repeated input is measured by us, not read from the provider.** Ollama reports no cache statistics, so a provider-sourced cache-hit rate is unavailable — and the metric that matters here is answerable without one: how much of this request did the model already receive earlier in this same task. Measuring it against the previous call's input within the task gives a number that is meaningful for every provider and directly actionable, since it is exactly what context compaction and prefix stability set out to reduce.

**Sizes are recorded in both units, not converted.** Tool results are carried as text; the number of tokens they become depends on the tokenizer. Recording only a token estimate would bury that approximation. Recording both keeps the exact measurement and the comparable one side by side, and makes the estimate's error visible if it is ever questioned.

## Risks / Trade-offs

**Token counts for tool output are estimates** → The providers in use do not tokenize tool results independently; the count has to be derived. Whatever method is chosen must be recorded as an estimate and used consistently, because the optimization work will compare these numbers before and after. A consistent estimate is sufficient for that comparison even if its absolute value is off; an inconsistent one is worthless.

**Attribution to the most recent message breaks under concurrent messages** → The recorder attributes calls to `currentPending`. Parallel sub-agents within one message are fine, since they share a task. Two messages processed at once would cross-attribute. The poller is sequential today, so this is latent rather than active — but this change adds `agent_id` and category attribution, which will make such a mix-up look like real data rather than obvious nonsense. Worth closing when message concurrency is introduced, and worth not forgetting until then.

**Measurement changes what is measured** → Category attribution and repeated-input measurement run on every call. They must stay cheap relative to an inference call, and must never fail a message: the existing recorder swallows and logs its own errors, and these computations belong inside that same guarantee.

**Mixed-era reports** → A database spanning the migration holds rows with zero in columns that did not exist. Reports must not average across that boundary as though the zeros were observations. The simplest defence is to key comparisons off the timestamp column, which is null exactly for the older rows.
