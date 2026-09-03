import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../logger.js';
import { migrate } from './migrations.js';
import { computeCost, isPriced, type PriceTable } from './pricing.js';
import { estimateTokens } from './token-estimate.js';
import type { LlmCallStats, MessageStats, StatsRecorder, ToolCallStats } from './types.js';

interface PendingMessage {
  id: number;
  receivedAt: number;
  toolCallCount: number;
}

/**
 * Writes agent operation stats to a local SQLite database. Never throws:
 * open failures and write failures are logged as warnings and swallowed, so
 * a broken stats path never affects message handling.
 *
 * `recordLlmCall`/`recordToolCall` carry no message-correlating id, so this
 * recorder attributes them to the most recently started message
 * (`currentPending`). This is correct as long as messages are processed
 * sequentially, which matches the bot's normal one-at-a-time operation;
 * overlapping concurrent messages may misattribute stats to each other.
 */
export class SqliteStatsRecorder implements StatsRecorder {
  private readonly storePrompts: boolean;
  private readonly priceTable: PriceTable;
  private db?: DatabaseSync;
  private insertMessageStmt?: StatementSync;
  private updateMessageStmt?: StatementSync;
  private insertLlmCallStmt?: StatementSync;
  private insertToolCallStmt?: StatementSync;

  private readonly pendingByChat = new Map<number, PendingMessage>();
  private currentPending?: PendingMessage;
  private lastLlmCallId?: number;

  constructor(dbPath: string, storePrompts: boolean, priceTable: PriceTable = {}) {
    this.storePrompts = storePrompts;
    this.priceTable = priceTable;

    try {
      mkdirSync(dirname(dbPath), { recursive: true });
      const db = new DatabaseSync(dbPath);
      migrate(db);

      this.db = db;
      this.insertMessageStmt = db.prepare(
        `INSERT INTO messages (timestamp, chat_id, prompt_text, total_ms, iterations, tool_calls, ok, reason)
         VALUES (?, ?, ?, 0, 0, 0, 0, NULL)`
      );
      this.updateMessageStmt = db.prepare(
        `UPDATE messages SET reply_text = ?, total_ms = ?, iterations = ?, tool_calls = ?, ok = ?, reason = ?
         WHERE id = ?`
      );
      this.insertLlmCallStmt = db.prepare(
        `INSERT INTO llm_calls (
           message_id, turn_number, role, agent_id, model, input_tokens, output_tokens, latency, ok,
           timestamp, cached_tokens, reasoning_tokens, usage_detail_reported, estimated_cost, priced,
           instruction_tokens, user_request_tokens, conversation_tokens, tool_output_tokens,
           repeated_input_tokens, new_input_tokens
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      this.insertToolCallStmt = db.prepare(
        `INSERT INTO tool_calls (message_id, llm_call_id, tool_name, args_json, duration, ok, output_size, input_size, output_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
    } catch (error) {
      logger.warn('Stats: failed to open database, stats recording disabled', {
        dbPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  recordMessage(stats: MessageStats): void {
    void this.write(() => {
      if (stats.receivedAt !== undefined) {
        this.insertMessageRow(stats);
      } else {
        this.completeMessageRow(stats);
      }
    });
  }

  recordLlmCall(stats: LlmCallStats): void {
    void this.write(() => this.insertLlmCallRow(stats));
  }

  recordToolCall(stats: ToolCallStats): void {
    void this.write(() => this.insertToolCallRow(stats));
  }

  private async write(fn: () => void): Promise<void> {
    try {
      fn();
    } catch (error) {
      logger.warn('Stats write failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private insertMessageRow(stats: MessageStats): void {
    if (!this.insertMessageStmt) return;

    const receivedAt = stats.receivedAt as number;
    const result = this.insertMessageStmt.run(
      new Date(receivedAt).toISOString(),
      stats.chatId,
      this.storePrompts ? (stats.prompt ?? null) : null
    );

    const pending: PendingMessage = { id: Number(result.lastInsertRowid), receivedAt, toolCallCount: 0 };
    this.pendingByChat.set(stats.chatId, pending);
    this.currentPending = pending;
  }

  private completeMessageRow(stats: MessageStats): void {
    if (!this.updateMessageStmt) return;

    const pending = this.pendingByChat.get(stats.chatId);
    if (!pending) return;
    this.pendingByChat.delete(stats.chatId);

    const totalMs = stats.replySentAt !== undefined ? stats.replySentAt - pending.receivedAt : 0;

    this.updateMessageStmt.run(
      this.storePrompts ? (stats.reply ?? null) : null,
      totalMs,
      stats.iterations ?? 0,
      pending.toolCallCount,
      stats.ok ? 1 : 0,
      stats.ok ? null : (stats.reason ?? null),
      pending.id
    );
  }

  private insertLlmCallRow(stats: LlmCallStats): void {
    if (!this.insertLlmCallStmt || !this.currentPending) return;

    const model = stats.model ?? 'unknown';
    const inputTokens = stats.usage?.promptTokens ?? 0;
    const outputTokens = stats.usage?.completionTokens ?? 0;
    const usageDetailReported = stats.usage?.cachedTokens !== undefined || stats.usage?.reasoningTokens !== undefined;
    const priced = isPriced(model, this.priceTable);
    const cost = computeCost({ inputTokens, outputTokens }, this.priceTable[model]);
    const category = stats.categoryTokens;
    const repeated = stats.repeatedInput;

    const result = this.insertLlmCallStmt.run(
      this.currentPending.id,
      stats.iteration,
      stats.role ?? 'main',
      stats.agentId ?? stats.role ?? 'main',
      model,
      inputTokens,
      outputTokens,
      stats.durationMs ?? 0,
      stats.ok ? 1 : 0,
      stats.calledAt !== undefined ? new Date(stats.calledAt).toISOString() : null,
      stats.usage?.cachedTokens ?? 0,
      stats.usage?.reasoningTokens ?? 0,
      usageDetailReported ? 1 : 0,
      cost,
      priced ? 1 : 0,
      category?.instructionTokens ?? 0,
      category?.userRequestTokens ?? 0,
      category?.conversationTokens ?? 0,
      category?.toolOutputTokens ?? 0,
      repeated?.repeatedTokens ?? 0,
      repeated?.newTokens ?? 0
    );

    this.lastLlmCallId = Number(result.lastInsertRowid);
  }

  private insertToolCallRow(stats: ToolCallStats): void {
    if (!this.insertToolCallStmt || !this.currentPending) return;

    const durationMs = stats.durationMs ?? 0;
    for (let i = 0; i < stats.toolCalls.length; i++) {
      const call = stats.toolCalls[i];
      const toolResult = stats.results[i];
      const ok = toolResult?.ok ?? false;
      const outputText = ok ? (toolResult?.output ?? '') : (toolResult?.error ?? '');
      const argsJson = JSON.stringify(call.arguments);

      this.insertToolCallStmt.run(
        this.currentPending.id,
        this.lastLlmCallId ?? null,
        call.name,
        argsJson,
        durationMs,
        ok ? 1 : 0,
        outputText.length,
        argsJson.length,
        estimateTokens(outputText)
      );
      this.currentPending.toolCallCount += 1;
    }
  }
}
