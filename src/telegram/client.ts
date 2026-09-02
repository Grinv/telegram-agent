export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

/** Narrow surface the orchestrator depends on, so it can be faked in tests. */
export interface TelegramReplier {
  sendMessage(chatId: number, text: string): Promise<void>;
}

export class TelegramClient implements TelegramReplier {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly apiBaseUrl: string = 'https://api.telegram.org'
  ) {}

  private apiUrl(method: string): string {
    return `${this.apiBaseUrl}/bot${this.token}/${method}`;
  }

  async getUpdates(offset: number | undefined, timeoutSeconds: number): Promise<TelegramUpdate[]> {
    const params = new URLSearchParams({ timeout: String(timeoutSeconds) });
    if (offset !== undefined) {
      params.set('offset', String(offset));
    }

    const response = await this.fetchImpl(`${this.apiUrl('getUpdates')}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`getUpdates failed with HTTP ${response.status}`);
    }

    const body = (await response.json()) as TelegramApiResponse<TelegramUpdate[]>;
    if (!body.ok) {
      throw new Error(`getUpdates returned an error: ${body.description ?? 'unknown error'}`);
    }

    return body.result;
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    const response = await this.fetchImpl(this.apiUrl('sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    if (!response.ok) {
      throw new Error(`sendMessage failed with HTTP ${response.status}`);
    }
  }
}
