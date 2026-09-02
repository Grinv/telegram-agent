import type { TokenUsage } from '../llm/types.js';

/** A model discovered from Ollama, with the metadata used to auto-select classifier/fallback. */
export interface ModelEntry {
  name: string;
  parameterSize: number;
  family: string;
  supportsTools: boolean;
}

/** How a message's model was chosen. */
export interface RoutingDecision {
  model: string;
  source: 'classifier' | 'fallback';
  reason?: string;
  classifierModel: string;
  classifierUsage?: TokenUsage;
}

/** Selects a model per message. Returned by `createRouter`, or omitted when routing is skipped. */
export interface Router {
  route(message: string): Promise<RoutingDecision>;
}
