import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './migrations.js';
import type { HistoryStore, HistoryTurn } from './types.js';

/** Persists per-chat conversation history to a local SQLite database. */
export class SqliteHistoryStore implements HistoryStore {
  private readonly db: DatabaseSync;
  private readonly selectStmt: StatementSync;
  private readonly insertStmt: StatementSync;
  private readonly deleteStmt: StatementSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    migrate(this.db);

    this.selectStmt = this.db.prepare(
      `SELECT role, content, sender_id, sender_name, created_at
       FROM turns WHERE chat_id = ? ORDER BY id ASC`
    );
    this.insertStmt = this.db.prepare(
      `INSERT INTO turns (chat_id, role, content, sender_id, sender_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    this.deleteStmt = this.db.prepare(`DELETE FROM turns WHERE chat_id = ?`);
  }

  getHistory(chatId: number): HistoryTurn[] {
    const rows = this.selectStmt.all(chatId) as Array<{
      role: string;
      content: string;
      sender_id: number | null;
      sender_name: string | null;
      created_at: number;
    }>;

    return rows.map((row) => ({
      role: row.role as HistoryTurn['role'],
      content: row.content,
      ...(row.sender_id !== null ? { senderId: row.sender_id } : {}),
      ...(row.sender_name !== null ? { senderName: row.sender_name } : {}),
      createdAt: row.created_at,
    }));
  }

  appendTurn(chatId: number, turn: Omit<HistoryTurn, 'createdAt'>): void {
    this.insertStmt.run(
      chatId,
      turn.role,
      turn.content,
      turn.senderId ?? null,
      turn.senderName ?? null,
      Date.now()
    );
  }

  clearHistory(chatId: number): void {
    this.deleteStmt.run(chatId);
  }
}
