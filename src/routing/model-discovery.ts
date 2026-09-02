import { logger } from '../logger.js';
import type { ModelEntry } from './types.js';

interface OllamaTagsResponse {
  models?: Array<{ name: string }>;
}

interface OllamaShowResponse {
  capabilities?: string[];
  details?: { family?: string; parameter_size?: string };
}

/** Multiplier to normalize a parameter-count unit suffix to billions of parameters. */
const UNIT_TO_BILLIONS: Record<string, number> = { K: 1e-6, M: 1e-3, B: 1, T: 1e3 };

/**
 * Parses Ollama's `parameter_size` string into a number of billions of
 * parameters, normalizing across unit suffixes ("8B" -> 8, "0.5B" -> 0.5,
 * "873.44M" -> 0.87344) so models reported in different units still compare
 * correctly by true magnitude. Defaults to 0 if unparseable.
 */
function parseParameterSize(raw: string | undefined): number {
  if (!raw) return 0;
  const match = /^([0-9.]+)\s*([KMBT])?/i.exec(raw);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  const unit = (match[2] ?? 'B').toUpperCase();
  return value * (UNIT_TO_BILLIONS[unit] ?? 1);
}

/**
 * Queries Ollama's `/api/tags` for the list of locally available models, then
 * `/api/show` for each to get its capabilities and details. Runs once at
 * startup, not per message. Never throws: any failure logs a warning and
 * resolves to an empty array, so routing is simply skipped.
 */
export async function discoverModels(ollamaBaseUrl: string, fetchImpl: typeof fetch): Promise<ModelEntry[]> {
  try {
    const tagsResponse = await fetchImpl(`${ollamaBaseUrl}/api/tags`);
    if (!tagsResponse.ok) {
      logger.warn('Model discovery: /api/tags responded with a non-OK status', { status: tagsResponse.status });
      return [];
    }

    const tags = (await tagsResponse.json()) as OllamaTagsResponse;
    const names = tags.models?.map((m) => m.name) ?? [];

    const entries: ModelEntry[] = [];
    for (const name of names) {
      const entry = await showModel(ollamaBaseUrl, fetchImpl, name);
      if (entry) entries.push(entry);
    }
    return entries;
  } catch (error) {
    logger.warn('Model discovery failed, routing will be skipped', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function showModel(ollamaBaseUrl: string, fetchImpl: typeof fetch, name: string): Promise<ModelEntry | undefined> {
  try {
    const response = await fetchImpl(`${ollamaBaseUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      logger.warn('Model discovery: /api/show responded with a non-OK status', { name, status: response.status });
      return undefined;
    }

    const data = (await response.json()) as OllamaShowResponse;
    return {
      name,
      parameterSize: parseParameterSize(data.details?.parameter_size),
      family: data.details?.family ?? '',
      supportsTools: data.capabilities?.includes('tools') ?? false,
    };
  } catch (error) {
    logger.warn('Model discovery: /api/show failed for a model, skipping it', {
      name,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
