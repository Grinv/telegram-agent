export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  from?: { id: number; name: string };
}

interface TelegramApiFrom {
  id: number;
  username?: string;
  first_name: string;
}

interface TelegramApiMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  from?: TelegramApiFrom;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramApiUpdate {
  update_id: number;
  message?: TelegramApiMessage;
}

function parseFrom(from: TelegramApiFrom | undefined): TelegramMessage['from'] {
  if (!from) return undefined;
  return { id: from.id, name: from.username ?? from.first_name };
}

function parseUpdate(update: TelegramApiUpdate): TelegramUpdate {
  if (!update.message) {
    return { update_id: update.update_id };
  }

  const { message_id, chat, text, from } = update.message;
  return {
    update_id: update.update_id,
    message: {
      message_id,
      chat,
      ...(text !== undefined ? { text } : {}),
      ...(from ? { from: parseFrom(from) } : {}),
    },
  };
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

/** The Bot API rejects a `sendMessage` text longer than this many UTF-16 code units. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Nudges a cut index back by one if it would fall between the two halves of a surrogate pair. */
function avoidSurrogateSplit(text: string, index: number): number {
  if (
    index > 0 &&
    index < text.length &&
    isHighSurrogate(text.charCodeAt(index - 1)) &&
    isLowSurrogate(text.charCodeAt(index))
  ) {
    return index - 1;
  }
  return index;
}

/** Finds where to end the next part: last line boundary within `limit`, else last word boundary, else a hard cut. */
function findCutPoint(text: string, limit: number): number {
  const maxCut = avoidSurrogateSplit(text, limit);

  const lastNewline = text.lastIndexOf('\n', maxCut - 1);
  if (lastNewline >= 0) {
    return lastNewline + 1;
  }

  const lastSpace = text.lastIndexOf(' ', maxCut - 1);
  if (lastSpace >= 0) {
    return lastSpace + 1;
  }

  return maxCut;
}

/**
 * Splits text into parts each within `limit` UTF-16 code units. Concatenating
 * the returned parts in order reproduces the input exactly. Never splits a
 * surrogate pair.
 */
export function splitMessageForDelivery(text: string, limit: number): string[] {
  if (text.length <= limit) {
    return [text];
  }

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    const cut = findCutPoint(remaining, limit);
    parts.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  parts.push(remaining);

  return parts;
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

    const body = (await response.json()) as TelegramApiResponse<TelegramApiUpdate[]>;
    if (!body.ok) {
      throw new Error(`getUpdates returned an error: ${body.description ?? 'unknown error'}`);
    }

    return body.result.map(parseUpdate);
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    const parts = splitMessageForDelivery(text, TELEGRAM_MESSAGE_LIMIT);
    for (const part of parts) {
      await this.sendPart(chatId, part);
    }
  }

  private async sendPart(chatId: number, text: string): Promise<void> {
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
