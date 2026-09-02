import type { LlmRequest, LlmResult } from './types.js';

export abstract class BaseConnector {
  abstract callLlm(request: LlmRequest): Promise<LlmResult>;
}
