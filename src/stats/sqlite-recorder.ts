import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../logger.js';
import type { LlmCallStats, MessageStats, StatsRecorder, ToolCallStats } from './types.js';

const SCHEMA_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url));

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
  private db?: DatabaseSync;
  private insertMessageStmt?: StatementSync;
  private updateMessageStmt?: StatementSync;
  private insertLlmCallStmt?: StatementSync;
  private insertToolCallStmt?: StatementSync;

  private readonly pendingByChat = new Map<number, PendingMessage>();
  private currentPending?: PendingMessage;
  private lastLlmCallId?: number;

  constructor(dbPath: string, storePrompts: boolean) {
    this.storePrompts = storePrompts;

    try {
      mkdirSync(dirname(dbPath), { recursive: true });
      const db = new DatabaseSync(dbPath);
      db.exec(readFileSync(SCHEMA_PATH, 'utf8'));

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
        `INSERT INTO llm_calls (message_id, call_index, role, model, prompt_tokens, completion_tokens, latency_ms, ok)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      this.insertToolCallStmt = db.prepare(
        `INSERT INTO tool_calls (message_id, llm_call_id, tool_name, args_json, latency_ms, ok, result_len)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
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

    const result = this.insertLlmCallStmt.run(
      this.currentPending.id,
      stats.iteration,
      'main',
      stats.model ?? 'unknown',
      stats.usage?.promptTokens ?? 0,
      stats.usage?.completionTokens ?? 0,
      stats.durationMs ?? 0,
      stats.ok ? 1 : 0
    );

    this.lastLlmCallId = Number(result.lastInsertRowid);
  }

  private insertToolCallRow(stats: ToolCallStats): void {
    if (!this.insertToolCallStmt || !this.currentPending) return;

    const latencyMs = stats.durationMs ?? 0;
    for (let i = 0; i < stats.toolCalls.length; i++) {
      const call = stats.toolCalls[i];
      const toolResult = stats.results[i];
      const ok = toolResult?.ok ?? false;
      const resultLen = ok ? (toolResult?.output?.length ?? 0) : (toolResult?.error?.length ?? 0);

      this.insertToolCallStmt.run(
        this.currentPending.id,
        this.lastLlmCallId ?? null,
        call.name,
        JSON.stringify(call.arguments),
        latencyMs,
        ok ? 1 : 0,
        resultLen
      );
      this.currentPending.toolCallCount += 1;
    }
  }
}
