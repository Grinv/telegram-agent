import type { LlmCallStats, MessageStats, StatsRecorder, ToolCallStats } from './types.js';

/**
 * Forwards every `record*` call to each of `recorders`, in order. Used to
 * compose the local SQLite recorder with the OTel exporter behind the single
 * `StatsRecorder` interface the orchestrator already calls, so
 * `src/orchestrator.ts` needs no new call sites (see design.md - Decisions,
 * "A second StatsRecorder implementation, composed with the existing one").
 */
export class CompositeStatsRecorder implements StatsRecorder {
  constructor(private readonly recorders: StatsRecorder[]) {}

  recordMessage(stats: MessageStats): void {
    for (const recorder of this.recorders) recorder.recordMessage(stats);
  }

  recordLlmCall(stats: LlmCallStats): void {
    for (const recorder of this.recorders) recorder.recordLlmCall(stats);
  }

  recordToolCall(stats: ToolCallStats): void {
    for (const recorder of this.recorders) recorder.recordToolCall(stats);
  }
}
