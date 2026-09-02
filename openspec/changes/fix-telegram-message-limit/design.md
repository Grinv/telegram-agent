## Context

The Telegram Bot API caps a `sendMessage` text at 4096 characters and returns HTTP 400 above it. `src/telegram/client.ts`'s `sendMessage` sends the text as-is, and `src/orchestrator.ts`'s `handleMessage` writes the finalizing `recordMessage({ ok: true, ... })` before awaiting delivery, then catches any send error in the generic `catch` block. See proposal.md — Why for how these two combine into a recorded success that the user never receives.

One detail shapes the split rules: the client sends `{ chat_id, text }` with no `parse_mode`, so Telegram treats the reply as plain text. There is no markup for a split to invalidate.

## Goals / Non-Goals

**Goals:**
- Deliver an over-long reply in full, in order, without the caller having to know the platform limit.
- Make recorded success mean "the user received the answer".

**Non-Goals:**
- Sending long content as a file attachment. Nothing sends reports to a chat today.
- Capping the number of parts. See Risks.
- Changing what the agent produces. This change is about delivery, not about making replies shorter — that is the separate token-optimization work.

## Decisions

**Splitting lives in the gateway, not the orchestrator.** The 4096 limit is a property of Telegram, and the orchestrator already talks to the gateway through the narrow `TelegramReplier` interface (`sendMessage(chatId, text)`). Putting the split behind that interface keeps the limit out of the orchestrator and out of every test that fakes a replier. The alternative — having the orchestrator chunk before calling — would leak a transport detail upward and force every future caller to remember it.

**Break at a line boundary, else a word boundary, else hard.** Walk back from the limit to the last newline; if none is within the part, the last space; if neither, cut at the limit. Rationale: agent replies are usually structured text where a line break is a natural seam. A hard cut is kept as the final fallback so a single unbroken 10k-character token still gets delivered rather than erroring.

**Measure in UTF-16 code units, and never split a surrogate pair.** Telegram counts the limit the way JavaScript's `String.length` does, so the same unit is used for the check. Splitting between the halves of a surrogate pair would corrupt the character, so a break lands on a code-point boundary.

**Finalize statistics after delivery, with a distinct reason.** The finalizing `recordMessage` moves below the `await` on delivery. A delivery failure records `ok=0` with a reason naming delivery, kept distinct from inference failures so the reports can tell "the agent failed" apart from "the agent worked and we could not deliver it". This also removes the current double-write, where the failure path's `recordMessage` is silently dropped because the recorder already consumed the pending row.

**A partly-delivered reply is a failure.** If part 3 of 5 is rejected, parts 1–2 are already in the chat and cannot be recalled. The run is recorded as failed. Attempting compensation (deleting the sent parts) adds API calls and failure modes for no real benefit — the user can see what arrived.

## Risks / Trade-offs

**A very long reply becomes many chat messages** → Not capped, deliberately. The reply is LLM-generated text, bounded by the model's own output limit, so the realistic worst case is a handful of parts. A cap would need a truncation policy and a config knob to express it; that is complexity bought against a case that has not occurred. Revisit if a real reply ever exceeds a few parts.

**Recorded success rate will drop** → Intended. It is currently inflated on exactly the long replies this change fixes. Anyone comparing statistics collected before and after this change must treat the two as different measurement regimes; this is why the change lands before the token-consumption baseline is captured.

**Partial delivery leaves the chat with a fragment** → Accepted. The alternative (buffer everything, verify, then send) is not available: there is no transactional multi-send in the Bot API.
