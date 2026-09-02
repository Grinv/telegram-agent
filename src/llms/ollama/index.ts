import { BaseConnector } from '../../llm/base-connector.js';
import type { ChatMessage, LlmRequest, LlmResult, ToolCall, TokenUsage } from '../../llm/types.js';

const DEFAULT_BASE_URL = 'http://ollama:11434';
const DEFAULT_MODEL = 'llama3';

export interface OllamaConnectorOptions {
  baseUrl?: string;
  model?: string;
}

interface OllamaChatFunction {
  name: string;
  arguments: Record<string, unknown>;
}

interface OllamaChatToolCall {
  function: OllamaChatFunction;
}

interface OllamaChatMessage {
  role: string;
  content?: string;
  tool_calls?: OllamaChatToolCall[];
}

interface OllamaChatResponse {
  message?: OllamaChatMessage;
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
  error?: string;
}

/**
 * Connector for an Ollama instance, selected via LLM_PROVIDER=ollama.
 * Uses `/api/chat` (not `/api/generate`) so tool definitions can be passed
 * and `message.tool_calls` parsed back. Even without tools, `/api/chat` with
 * a single user message works and simplifies the connector to one code path.
 */
export class OllamaConnector extends BaseConnector {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(
    options: OllamaConnectorOptions = {},
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
    this.baseUrl = options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL;
    this.model = options.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
  }

  async callLlm(request: LlmRequest): Promise<LlmResult> {
    try {
      const messages = this.buildMessages(request);
      const body: Record<string, unknown> = {
        model: request.model ?? this.model,
        messages,
        stream: false,
      };
      if (request.tools && request.tools.length > 0) {
        body.tools = request.tools;
      }
      if (request.think !== undefined) {
        body.think = request.think;
      }

      const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return {
          ok: false,
          reason: 'PROVIDER_ERROR',
          message: `Ollama responded with HTTP ${response.status}`,
        };
      }

      const data = (await response.json()) as OllamaChatResponse;
      if (data.error) {
        return {
          ok: false,
          reason: 'PROVIDER_ERROR',
          message: data.error,
        };
      }

      const message = data.message;
      if (!message) {
        return {
          ok: false,
          reason: 'PROVIDER_ERROR',
          message: 'Ollama response was missing the "message" field',
        };
      }

      const toolCalls = this.parseToolCalls(message.tool_calls);
      const usage = this.parseUsage(data);

      return {
        ok: true,
        text: message.content ?? '',
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(usage ? { usage } : {}),
      };
    } catch (error) {
      return {
        ok: false,
        reason: 'PROVIDER_ERROR',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private buildMessages(request: LlmRequest): OllamaChatMessage[] {
    const userMessage: OllamaChatMessage = { role: 'user', content: request.prompt };

    if (request.messages && request.messages.length > 0) {
      return [
        userMessage,
        ...request.messages.map((msg) => this.toOllamaMessage(msg)),
      ];
    }

    return [userMessage];
  }

  private toOllamaMessage(msg: ChatMessage): OllamaChatMessage {
    switch (msg.role) {
      case 'user':
        return { role: 'user', content: msg.content };
      case 'assistant':
        return {
          role: 'assistant',
          content: msg.content,
          ...(msg.tool_calls ? { tool_calls: msg.tool_calls.map((tc) => ({ function: { name: tc.name, arguments: tc.arguments } })) } : {}),
        };
      case 'tool':
        return { role: 'tool', content: msg.content };
    }
  }

  private parseToolCalls(raw: OllamaChatToolCall[] | undefined): ToolCall[] {
    if (!raw || raw.length === 0) {
      return [];
    }
    return raw.map((tc) => ({
      name: tc.function.name,
      arguments: tc.function.arguments ?? {},
    }));
  }

  private parseUsage(data: OllamaChatResponse): TokenUsage | undefined {
    if (data.prompt_eval_count === undefined && data.eval_count === undefined) {
      return undefined;
    }
    return {
      promptTokens: data.prompt_eval_count ?? 0,
      completionTokens: data.eval_count ?? 0,
      ...(data.total_duration !== undefined ? { totalDurationMs: data.total_duration / 1e6 } : {}),
    };
  }
}

export default OllamaConnector;
