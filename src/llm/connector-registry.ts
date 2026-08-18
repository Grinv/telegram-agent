import type { BaseConnector } from './base-connector.js';
import { StubConnector } from '../llms/stub/index.js';
import { OllamaConnector } from '../llms/ollama/index.js';

const CONNECTOR_FACTORIES: Record<string, () => BaseConnector> = {
  stub: () => new StubConnector(),
  ollama: () => new OllamaConnector(),
};

export const KNOWN_PROVIDERS: readonly string[] = Object.keys(CONNECTOR_FACTORIES);

export class ConnectorNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`No LLM connector is registered for provider "${provider}"`);
    this.name = 'ConnectorNotConfiguredError';
  }
}

export function createConnector(provider: string): BaseConnector {
  const factory = CONNECTOR_FACTORIES[provider];
  if (!factory) {
    throw new ConnectorNotConfiguredError(provider);
  }
  return factory();
}
