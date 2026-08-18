import type { LlmFailureReason } from './types.js';

export const FAILURE_LABELS: Record<LlmFailureReason, string> = {
  NOT_CONFIGURED: 'LLM provider not configured',
  PROVIDER_ERROR: 'LLM provider error',
  TIMEOUT: 'LLM inference timed out',
};
