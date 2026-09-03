import { SqliteHistoryStore } from './sqlite-store.js';
import type { HistoryStore } from './types.js';

export function createHistoryStore(dbPath: string): HistoryStore {
  return new SqliteHistoryStore(dbPath);
}

export type { HistoryStore, HistoryTurn } from './types.js';
