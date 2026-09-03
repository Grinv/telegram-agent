import type { HistoryStore, HistoryTurn } from '../src/history/types.js';

/**
 * A `HistoryStore` backed by an in-memory map, scoped to whatever holds the
 * instance. The runner creates one fresh instance per task execution so
 * every execution starts with empty history and none can see another's
 * turns (see specs/agent-benchmark/spec.md — "Tasks do not inherit each
 * other's history").
 */
export function createInMemoryHistoryStore(): HistoryStore {
  const turnsByChat = new Map<number, HistoryTurn[]>();

  return {
    getHistory(chatId: number): HistoryTurn[] {
      return turnsByChat.get(chatId) ?? [];
    },
    appendTurn(chatId: number, turn: Omit<HistoryTurn, 'createdAt'>): void {
      const turns = turnsByChat.get(chatId) ?? [];
      turns.push({ ...turn, createdAt: Date.now() });
      turnsByChat.set(chatId, turns);
    },
    clearHistory(chatId: number): void {
      turnsByChat.delete(chatId);
    },
  };
}
