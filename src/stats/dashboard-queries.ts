import type { DatabaseSync } from 'node:sqlite';

/** One tool's share of the tokens tools produced (`tool_calls.output_tokens`), ranked against the total across all tools. */
export interface ToolTokenShare {
  toolName: string;
  tokens: number;
  share: number;
}

/** Pure read: ranks tools by the tokens their results produced, each row's share a fraction of the total across all tools. */
export function toolTokenShares(db: DatabaseSync): ToolTokenShare[] {
  const rows = db
    .prepare(
      `SELECT tool_name, SUM(output_tokens) AS tokens
       FROM tool_calls GROUP BY tool_name ORDER BY tokens DESC`
    )
    .all() as unknown as Array<{ tool_name: string; tokens: number }>;

  const total = rows.reduce((sum, r) => sum + r.tokens, 0);
  return rows.map((r) => ({ toolName: r.tool_name, tokens: r.tokens, share: total > 0 ? r.tokens / total : 0 }));
}

export interface SummaryStats {
  taskCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  /** Fraction of input tokens served from cache, over calls whose provider reported cache stats. `null` when none did. */
  cacheHitRate: number | null;
  estimatedCost: number;
  /** True when some of the activity included in `estimatedCost` used a model with no configured price (or predates cost tracking). */
  costPartial: boolean;
  avgTokensPerTask: number;
  avgTurnsPerTask: number;
  avgToolCallsPerTask: number;
  toolShares: ToolTokenShare[];
}

/** Pure read: summary over all recorded activity. Returns `null` when the database holds no tasks. */
export function summaryStats(db: DatabaseSync): SummaryStats | null {
  const taskCount = (db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n;
  if (taskCount === 0) return null;

  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS calls,
         SUM(input_tokens) AS input_tokens,
         SUM(output_tokens) AS output_tokens,
         SUM(cached_tokens) AS cached_tokens,
         SUM(estimated_cost) AS estimated_cost,
         SUM(CASE WHEN priced = 0 THEN 1 ELSE 0 END) AS unpriced_calls,
         SUM(CASE WHEN usage_detail_reported = 1 THEN cached_tokens ELSE 0 END) AS reported_cached_tokens,
         SUM(CASE WHEN usage_detail_reported = 1 THEN input_tokens ELSE 0 END) AS reported_input_tokens,
         SUM(CASE WHEN usage_detail_reported = 1 THEN 1 ELSE 0 END) AS reported_calls
       FROM llm_calls`
    )
    .get() as unknown as {
    calls: number;
    input_tokens: number | null;
    output_tokens: number | null;
    cached_tokens: number | null;
    estimated_cost: number | null;
    unpriced_calls: number;
    reported_cached_tokens: number;
    reported_input_tokens: number;
    reported_calls: number;
  };

  const toolCallCount = (db.prepare('SELECT COUNT(*) AS n FROM tool_calls').get() as { n: number }).n;

  const inputTokens = totals.input_tokens ?? 0;
  const outputTokens = totals.output_tokens ?? 0;

  return {
    taskCount,
    inputTokens,
    outputTokens,
    cachedTokens: totals.cached_tokens ?? 0,
    cacheHitRate: totals.reported_calls > 0 ? totals.reported_cached_tokens / totals.reported_input_tokens : null,
    estimatedCost: totals.estimated_cost ?? 0,
    costPartial: totals.unpriced_calls > 0,
    avgTokensPerTask: (inputTokens + outputTokens) / taskCount,
    avgTurnsPerTask: totals.calls / taskCount,
    avgToolCallsPerTask: toolCallCount / taskCount,
    toolShares: toolTokenShares(db),
  };
}

export interface TimelineToolCall {
  toolName: string;
  ok: boolean;
  resultSize: number;
  outputTokens: number;
}

export interface TimelineTurn {
  turnNumber: number;
  model: string;
  role: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: TimelineToolCall[];
}

export interface TaskTimeline {
  taskId: number;
  turns: TimelineTurn[];
}

/** Pure read: one task's turns in order with their tool calls. Returns `null` when `taskId` is not a known message id. */
export function taskTimeline(db: DatabaseSync, taskId: number): TaskTimeline | null {
  const exists = db.prepare('SELECT id FROM messages WHERE id = ?').get(taskId);
  if (!exists) return null;

  const turns = db
    .prepare(
      `SELECT id, turn_number, model, role, input_tokens, output_tokens
       FROM llm_calls WHERE message_id = ? ORDER BY turn_number ASC`
    )
    .all(taskId) as unknown as Array<{
    id: number;
    turn_number: number;
    model: string;
    role: string;
    input_tokens: number;
    output_tokens: number;
  }>;

  const toolRows = db
    .prepare(
      `SELECT llm_call_id, tool_name, ok, output_size, output_tokens
       FROM tool_calls WHERE message_id = ? AND llm_call_id IS NOT NULL ORDER BY id ASC`
    )
    .all(taskId) as unknown as Array<{
    llm_call_id: number;
    tool_name: string;
    ok: number;
    output_size: number;
    output_tokens: number;
  }>;

  return {
    taskId,
    turns: turns.map((t) => ({
      turnNumber: t.turn_number,
      model: t.model,
      role: t.role,
      inputTokens: t.input_tokens,
      outputTokens: t.output_tokens,
      toolCalls: toolRows
        .filter((tc) => tc.llm_call_id === t.id)
        .map((tc) => ({ toolName: tc.tool_name, ok: tc.ok === 1, resultSize: tc.output_size, outputTokens: tc.output_tokens })),
    })),
  };
}

export interface MostExpensiveTurn {
  taskId: number;
  turnNumber: number;
  model: string;
  inputTokens: number;
}

/** Per-content-category share of input tokens, aggregated over calls recorded under the current attribution (`attribution_version = 1`). */
export interface CategoryShares {
  instructionTokens: number;
  userRequestTokens: number;
  conversationTokens: number;
  toolOutputTokens: number;
  /** The definitions of the tools advertised to the model - its own category, distinct from the agent's instructions. */
  toolDefinitionTokens: number;
  totalTokens: number;
  /** Rows predating category attribution, or recorded under the previous (tool-definition-blind) attribution, excluded from these totals. */
  excludedRows: number;
}

export interface RepeatedVsNew {
  repeatedTokens: number;
  newTokens: number;
  /** Rows predating repeated-input measurement, or recorded under the previous (tool-definition-blind) attribution, excluded from these totals. */
  excludedRows: number;
}

export interface AnalysisStats {
  toolShares: ToolTokenShare[];
  mostExpensiveTurn: MostExpensiveTurn | null;
  categoryShares: CategoryShares;
  repeatedVsNew: RepeatedVsNew;
}

/** Pure read: token-consumption analysis over all recorded activity. Returns `null` when the database holds no calls. */
export function analysisStats(db: DatabaseSync): AnalysisStats | null {
  const callCount = (db.prepare('SELECT COUNT(*) AS n FROM llm_calls').get() as { n: number }).n;
  if (callCount === 0) return null;

  const expensive = db
    .prepare(
      `SELECT message_id, turn_number, model, input_tokens
       FROM llm_calls ORDER BY input_tokens DESC LIMIT 1`
    )
    .get() as unknown as { message_id: number; turn_number: number; model: string; input_tokens: number } | undefined;

  // `attribution_version = 1` marks rows recorded under the current
  // attribution (tool definitions included); rows predating either category
  // attribution entirely or this attribution fix land on the migration
  // default (0) and are excluded rather than averaged in as though they were
  // the same measurement (see openspec/changes/fix-context-attribution).
  const categoryRow = db
    .prepare(
      `SELECT
         SUM(instruction_tokens) AS instruction_tokens,
         SUM(user_request_tokens) AS user_request_tokens,
         SUM(conversation_tokens) AS conversation_tokens,
         SUM(tool_output_tokens) AS tool_output_tokens,
         SUM(tool_definition_tokens) AS tool_definition_tokens,
         COUNT(*) AS included
       FROM llm_calls WHERE attribution_version = 1`
    )
    .get() as unknown as {
    instruction_tokens: number | null;
    user_request_tokens: number | null;
    conversation_tokens: number | null;
    tool_output_tokens: number | null;
    tool_definition_tokens: number | null;
    included: number;
  };

  const repeatedRow = db
    .prepare(
      `SELECT SUM(repeated_input_tokens) AS repeated_tokens, SUM(new_input_tokens) AS new_tokens, COUNT(*) AS included
       FROM llm_calls WHERE attribution_version = 1`
    )
    .get() as unknown as { repeated_tokens: number | null; new_tokens: number | null; included: number };

  const instructionTokens = categoryRow.instruction_tokens ?? 0;
  const userRequestTokens = categoryRow.user_request_tokens ?? 0;
  const conversationTokens = categoryRow.conversation_tokens ?? 0;
  const toolOutputTokens = categoryRow.tool_output_tokens ?? 0;
  const toolDefinitionTokens = categoryRow.tool_definition_tokens ?? 0;

  return {
    toolShares: toolTokenShares(db),
    mostExpensiveTurn: expensive
      ? { taskId: expensive.message_id, turnNumber: expensive.turn_number, model: expensive.model, inputTokens: expensive.input_tokens }
      : null,
    categoryShares: {
      instructionTokens,
      userRequestTokens,
      conversationTokens,
      toolOutputTokens,
      toolDefinitionTokens,
      totalTokens: instructionTokens + userRequestTokens + conversationTokens + toolOutputTokens + toolDefinitionTokens,
      excludedRows: callCount - categoryRow.included,
    },
    repeatedVsNew: {
      repeatedTokens: repeatedRow.repeated_tokens ?? 0,
      newTokens: repeatedRow.new_tokens ?? 0,
      excludedRows: callCount - repeatedRow.included,
    },
  };
}
