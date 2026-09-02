import type { LlmFailureReason, LlmRequest, LlmResult, TokenUsage } from '../llm/types.js';
import type { ModelEntry } from './types.js';

/**
 * Provider is already bound by the caller (routing is Ollama-specific — see
 * `createRouter`), so only the timeout varies per call.
 */
export type CallLlm = (request: LlmRequest, options: { timeoutMs: number }) => Promise<LlmResult>;

export interface ClassifyModelDeps {
  callLlm: CallLlm;
  classifierModel: string;
  timeoutMs: number;
}

export interface ClassifyModelResult {
  model: string | null;
  usage?: TokenUsage;
  /** Present when the call itself failed (not just an unrecognized response) — lets the router distinguish a timeout from other provider errors. */
  failureReason?: LlmFailureReason;
}

function buildPrompt(message: string, models: ModelEntry[]): string {
  const modelList = models
    .map((m, i) => `${i + 1}. ${m.name} (${m.parameterSize}B params, ${m.supportsTools ? 'supports tools' : 'no tools'})`)
    .join('\n');

  return `You are a model router. Given a user message and a list of available models,
pick the most suitable model.

User message: "${message}"

Available models:
${modelList}

Guidelines:
- Simple greetings, basic math, short answers -> small model
- Code generation, complex reasoning, multi-step tasks -> large model
- If tools are needed (the user asks to execute commands, read/write files),
  pick a model that supports tools

Respond with ONLY the model name, nothing else.`;
}

/**
 * Asks the classifier model to pick which available model should handle
 * `message`. Returns `{ model: null }` on any failure (timeout, provider
 * error, or an unrecognized response) so the caller can fall back.
 */
export async function classifyModel(
  message: string,
  models: ModelEntry[],
  deps: ClassifyModelDeps,
): Promise<ClassifyModelResult> {
  const request: LlmRequest = {
    prompt: buildPrompt(message, models),
    model: deps.classifierModel,
    think: false,
  };

  const result = await deps.callLlm(request, { timeoutMs: deps.timeoutMs });

  if (!result.ok) {
    return { model: null, failureReason: result.reason };
  }

  const candidate = result.text.trim();
  const match = matchModelName(candidate, models);

  return { model: match, ...(result.usage ? { usage: result.usage } : {}) };
}

/**
 * Matches the classifier's (trimmed) response text against known model
 * names: an exact match first, then — since a model doesn't always follow
 * "respond with ONLY the model name" — whether the response starts with a
 * known name, preferring the longest match if more than one name is a valid
 * prefix. Returns `null` if neither matches.
 */
function matchModelName(candidate: string, models: ModelEntry[]): string | null {
  const exact = models.find((m) => m.name === candidate);
  if (exact) return exact.name;

  const prefixMatches = models.filter((m) => candidate.startsWith(m.name));
  if (prefixMatches.length === 0) return null;

  return prefixMatches.reduce((longest, m) => (m.name.length > longest.name.length ? m : longest)).name;
}
