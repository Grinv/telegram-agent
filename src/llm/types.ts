export type LlmFailureReason = 'NOT_CONFIGURED' | 'PROVIDER_ERROR' | 'TIMEOUT';

export interface LlmSuccess {
  ok: true;
  text: string;
}

export interface LlmFailure {
  ok: false;
  reason: LlmFailureReason;
  message: string;
}

export type LlmResult = LlmSuccess | LlmFailure;
