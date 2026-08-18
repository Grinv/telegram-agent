import { BaseConnector } from '../../llm/base-connector.js';
import type { LlmResult } from '../../llm/types.js';

/**
 * Placeholder connector used while no real LLM provider (e.g. Ollama) is connected.
 */
export class StubConnector extends BaseConnector {
  async callLlm(prompt: string): Promise<LlmResult> {
    return {
      ok: true,
      text: `[stub] I received your message: "${prompt}". A real LLM is not connected yet.`,
    };
  }
}

export default StubConnector;
