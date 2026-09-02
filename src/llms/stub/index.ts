import { BaseConnector } from '../../llm/base-connector.js';
import type { LlmRequest, LlmResult } from '../../llm/types.js';

/**
 * Placeholder connector used while no real LLM provider (e.g. Ollama) is connected.
 * Ignores tools, messages, and model — always returns deterministic placeholder text.
 */
export class StubConnector extends BaseConnector {
  async callLlm(request: LlmRequest): Promise<LlmResult> {
    return {
      ok: true,
      text: `[stub] I received your message: "${request.prompt}". A real LLM is not connected yet.`,
    };
  }
}

export default StubConnector;
