import { BaseConnector } from '../../llm/base-connector.js';
import type { LlmResult } from '../../llm/types.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'llama3';

interface OllamaConnectorOptions {
  baseUrl?: string;
  model?: string;
}

interface OllamaGenerateResponse {
  response?: string;
}

/**
 * Connector for a local Ollama instance, selected via LLM_PROVIDER=ollama
 * (the default - see openspec/specs/llm-inference/spec.md).
 */
export class OllamaConnector extends BaseConnector {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(
    options: OllamaConnectorOptions = {},
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    super();
    this.baseUrl = options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL;
    this.model = options.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
  }

  async callLlm(prompt: string): Promise<LlmResult> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt, stream: false }),
      });

      if (!response.ok) {
        return {
          ok: false,
          reason: 'PROVIDER_ERROR',
          message: `Ollama responded with HTTP ${response.status}`,
        };
      }

      const data = (await response.json()) as OllamaGenerateResponse;
      if (!data.response) {
        return {
          ok: false,
          reason: 'PROVIDER_ERROR',
          message: 'Ollama response was missing the "response" field',
        };
      }

      return { ok: true, text: data.response };
    } catch (error) {
      return {
        ok: false,
        reason: 'PROVIDER_ERROR',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export default OllamaConnector;
