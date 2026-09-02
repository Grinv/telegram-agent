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

/** Structured outcome of executing a single tool call. */
export interface ToolResult {
  ok: boolean;
  output?: string;
  error?: string;
}

/** Token-usage metadata reported by the provider when available. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
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

export type ChatMessage = UserMessage | AssistantMessage | ToolMessage;

/**
 * Request carried across the connector contract. `prompt` is always present
 * (the latest user turn); `messages` carries the full conversation history for
 * tool-use loops; `tools` advertises available tools; `model` overrides the
 * connector's default model for this call; `think` disables the model's
 * "thinking" mode when set to `false` (unset leaves the provider's default).
 */
export interface LlmRequest {
  prompt: string;
  messages?: ChatMessage[];
  tools?: ToolDefinition[];
  model?: string;
  think?: boolean;
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
