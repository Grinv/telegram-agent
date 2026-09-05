import type { ChatMessage, CallLlm } from '../llm/types.js';
import type { StatsRecorder } from '../stats/types.js';
import { estimateTokens } from '../stats/token-estimate.js';

export interface CompactionDeps {
  callLlm: CallLlm;
  provider: string;
  timeoutMs: number;
  model?: string;
  statsRecorder?: StatsRecorder;
}

export interface CompactionResult {
  messages: ChatMessage[];
  compacted: boolean;
}

/** Estimated size (tokens) of a rendered conversation. */
export function estimateConversationTokens(messages: ChatMessage[]): number {
  return estimateTokens(messages.map((m) => m.content).join('\n'));
}

/**
 * Splits `messages` (oldest -> newest) into earlier turns to summarize and
 * recent turns to keep intact: as many of the most recent turns as fit
 * under `recentBudget` estimated tokens, always at least one turn when any
 * exist, so "recent" never ends up empty just because the newest turn alone
 * exceeds the budget.
 */
function splitForCompaction(
  messages: ChatMessage[],
  recentBudget: number,
): { earlier: ChatMessage[]; recent: ChatMessage[] } {
  let used = 0;
  let splitIndex = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateTokens(messages[i].content);
    if (splitIndex < messages.length && used + cost > recentBudget) break;
    used += cost;
    splitIndex = i;
  }
  return { earlier: messages.slice(0, splitIndex), recent: messages.slice(splitIndex) };
}

function renderForSummary(messages: ChatMessage[]): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join('\n');
}

const SUMMARY_PROMPT_PREFIX =
  'Summarize the following conversation turns concisely, preserving every fact a later turn might need to refer back to:\n\n';

/**
 * Compacts `messages` when their estimated size exceeds `threshold`: recent
 * turns are kept intact and earlier turns are replaced by a single summary
 * message, produced by its own LLM call so the saving is measured net of
 * that cost (see design.md — "Compaction's summarization spends tokens to
 * save tokens"). Returns the input unchanged (`compacted: false`) when under
 * the threshold, never spending a summarization call on a conversation that
 * doesn't need one. Affects only the returned message list — the caller's
 * stored conversation is untouched either way.
 */
export async function compactConversation(
  messages: ChatMessage[],
  threshold: number,
  deps: CompactionDeps,
): Promise<CompactionResult> {
  if (estimateConversationTokens(messages) <= threshold) {
    return { messages, compacted: false };
  }

  const { earlier, recent } = splitForCompaction(messages, threshold);
  if (earlier.length === 0) {
    return { messages, compacted: false };
  }

  const startedAt = Date.now();
  const result = await deps.callLlm(
    { prompt: SUMMARY_PROMPT_PREFIX + renderForSummary(earlier), ...(deps.model ? { model: deps.model } : {}) },
    { provider: deps.provider, timeoutMs: deps.timeoutMs },
  );
  const durationMs = Date.now() - startedAt;

  deps.statsRecorder?.recordLlmCall({
    iteration: -1,
    role: 'compaction',
    ...(deps.model ? { model: deps.model } : {}),
    ok: result.ok,
    ...(result.ok ? { text: result.text } : {}),
    ...(result.ok && result.usage ? { usage: result.usage } : {}),
    durationMs,
    calledAt: startedAt,
  });

  const summaryText = result.ok ? result.text : '(summary unavailable; earlier turns omitted)';
  const summaryMessage: ChatMessage = { role: 'system', content: `Summary of earlier conversation:\n${summaryText}` };

  return { messages: [summaryMessage, ...recent], compacted: true };
}
