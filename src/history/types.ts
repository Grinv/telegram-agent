export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
  senderId?: number;
  senderName?: string;
  createdAt: number;
}

/** Per-chat conversation history, persisted across process restarts. */
export interface HistoryStore {
  getHistory(chatId: number): HistoryTurn[];
  appendTurn(chatId: number, turn: Omit<HistoryTurn, 'createdAt'>): void;
  clearHistory(chatId: number): void;
}
