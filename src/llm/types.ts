export type LlmFailureReason = 'NOT_CONFIGURED' | 'PROVIDER_ERROR' | 'TIMEOUT';

/** A tool definition advertised to the LLM so it can decide which tool to call. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema describing the tool's arguments. */
  parameters: Record<string, unknown>;
}

/** A tool call requested by the LLM. `arguments` is the parsed argument object. */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Structured outcome of executing a single tool call. `truncated`/`compressed`
 * are set (never `false`) when the tool-result limit or shell-output
 * compression reduced `output`/`error` from what the tool itself produced -
 * see `src/context-management/`.
 */
export interface ToolResult {
  ok: boolean;
  output?: string;
  error?: string;
  truncated?: boolean;
  compressed?: boolean;
}

/**
 * Token-usage metadata reported by the provider when available. `cachedTokens`
 * and `reasoningTokens` are omitted entirely (not `0`) when the provider does
 * not report them, so a recorder can distinguish "reported as zero" from
 * "never reported" rather than treating an absent count as an observed zero.
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  totalDurationMs?: number;
}

export interface UserMessage {
  role: 'user';
  content: string;
}

export interface AssistantMessage {
  role: 'assistant';
  content: string;
  tool_calls?: ToolCall[];
}

export interface ToolMessage {
  role: 'tool';
  content: string;
  name: string;
}

export interface SystemMessage {
  role: 'system';
  content: string;
}

export type ChatMessage = UserMessage | AssistantMessage | ToolMessage | SystemMessage;

/**
 * Sampling controls a request can ask a provider for, to make generation as
 * reproducible as the provider supports (e.g. greedy decoding with a fixed
 * seed). Optional and provider-dependent: a connector whose provider doesn't
 * support them ignores them rather than failing.
 */
export interface SamplingControls {
  temperature?: number;
  seed?: number;
}

/**
 * Request carried across the connector contract. `prompt` is always present
 * (the latest user turn); `messages` carries the full conversation history for
 * tool-use loops; `tools` advertises available tools; `model` overrides the
 * connector's default model for this call; `think` disables the model's
 * "thinking" mode when set to `false` (unset leaves the provider's default);
 * `sampling` requests deterministic generation controls, absent by default so
 * ordinary requests behave exactly as before.
 */
export interface LlmRequest {
  prompt: string;
  messages?: ChatMessage[];
  tools?: ToolDefinition[];
  model?: string;
  think?: boolean;
  sampling?: SamplingControls;
}

export interface LlmSuccess {
  ok: true;
  text: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
}

export interface LlmFailure {
  ok: false;
  reason: LlmFailureReason;
  message: string;
}

export type LlmResult = LlmSuccess | LlmFailure;

/** Shape of the isolated inference call the orchestrator (and nested loops) invoke. */
export type CallLlm = (request: LlmRequest, options: { provider: string; timeoutMs: number }) => Promise<LlmResult>;
