import type { LlmResult } from './types.js';

export abstract class BaseConnector {
  abstract callLlm(prompt: string): Promise<LlmResult>;
}
