## Context

See `proposal.md` for motivation and the live reproduction. Relevant current state:

- `runLoop` (`src/orchestrator.ts`) success path: `if (!result.toolCalls || result.toolCalls.length === 0) { return { ok: true, text: result.text, iterations: i + 1 }; }` — this fires whenever the connector reports `ok: true` and there are no tool calls, regardless of whether `result.text` is non-empty.
- The existing loop-failure shape is `{ ok: false, reason: string, iterations: number }` (`LoopResult`), already used for `'MAX_ITERATIONS'` — `reason` is a plain `string`, not the connector-level `LlmFailureReason` union (`NOT_CONFIGURED | PROVIDER_ERROR | TIMEOUT`, `src/llm/types.ts`), so adding a new reason here requires no type change.
- `createMessageHandler` already branches on `result.ok`: `const reply = result.ok ? result.text : FAILURE_REPLY_TEXT;` — an `ok: false` result already gets the generic failure notice and skips `client.sendMessage` with the LLM's own text, skips the `historyStore.appendTurn` assistant-turn call (only fires `if (result.ok)`), and `statsRecorder.recordMessage` receives `reason: result.reason` directly.

## Goals / Non-Goals

**Goals:**
- Stop an empty, tool-call-free LLM response from reaching `client.sendMessage` at all.
- Reuse every downstream branch that already exists for a failed `LoopResult` (failure notice, stats reason, history behavior) — this is a classification fix at the point the outcome is decided, not a new downstream code path.

**Non-Goals:**
- No retry of the same iteration on an empty response. The model already had its turn within the current iteration; retrying adds complexity (another call, another timeout budget) for a case with no evidence it changes the outcome for a model that just failed to produce output. `maxIterations` retries only apply when the LLM itself asks to continue via tool calls, which this case does not.
- No change to what counts as an LLM connector failure (`LlmFailureReason`). An empty response is a valid provider response (`ok: true`) — the connector did its job; the loop's classification of that response is what changes.

## Decisions

**Check placement: inside `runLoop`'s existing success branch, before the return.**
```ts
if (!result.toolCalls || result.toolCalls.length === 0) {
  if (result.text.trim().length === 0) {
    logger.warn('LLM returned an empty response with no tool call', { iteration: i, model });
    return { ok: false, reason: 'EMPTY_RESPONSE', iterations: i + 1 };
  }
  return { ok: true, text: result.text, iterations: i + 1 };
}
```
`.trim()` (not a bare `=== ''` check) so a whitespace-only response (seen as plausible model output, not just literal `""`) is treated the same way — Telegram would reject either identically. Alternative considered: check at the `createMessageHandler` level instead of inside `runLoop` — rejected because `runLoop` is the reusable, standalone loop (`bot-orchestrator` requirement "Loop is extracted as a reusable function"); a subagent invocation of `runLoop` should get the same classification without `createMessageHandler` in the call path.

**Reason string: `'EMPTY_RESPONSE'`, a new value in the same untyped `reason: string` slot `'MAX_ITERATIONS'` already uses.**
No `LlmFailureReason`/`FAILURE_LABELS` change: that map is keyed by the connector-level union and is only consulted in the `!result.ok` branch (a real connector failure) to build the `logger.error` label — this new case never reaches that branch since `result.ok` is `true`. It gets its own `logger.warn` line instead, mirroring how `MAX_ITERATIONS` logs via its own `logger.warn('Max iterations reached', ...)` rather than through `FAILURE_LABELS`.

**No `statsRecorder`/`historyStore` code change.**
Both already key off `LoopResult.ok`/`reason` generically (`statsRecorder.recordMessage({ ..., reason: result.reason, ok: result.ok })`, `if (result.ok) { historyStore.appendTurn(...) }`), so routing this new case through the existing `ok: false` path is sufficient — confirmed by the live reproduction, where the *coincidentally* correct behavior (only the user turn persisted, stats marked `DELIVERY_FAILED`) already happened by accident through the `sendMessage` HTTP 400 catch path. This change makes that behavior deliberate and gives it a specific, correct reason (`'EMPTY_RESPONSE'` instead of `'DELIVERY_FAILED'`) instead of relying on Telegram's rejection as the detection mechanism.

## Risks / Trade-offs

- **[Risk]** A legitimately empty-but-intentional model reply (unlikely for a text-generation model, but not impossible for a provider that sometimes ends a turn on pure tool-call intent without setting `toolCalls`) is now converted to a failure notice instead of a silent no-op. → **Mitigation**: none needed — sending an empty Telegram message was never a working code path to begin with (rejected with HTTP 400 today, unconditionally); this change only makes the already-broken outcome explicit and correctly labeled instead of accidental.
