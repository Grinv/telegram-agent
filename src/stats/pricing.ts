import { existsSync, readFileSync } from 'node:fs';
import { logger } from '../logger.js';

/** Price for one model, in currency units per million tokens. */
export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

/** Maps a model name to its configured price. A model absent from the table has no configured price. */
export type PriceTable = Record<string, ModelPrice>;

/**
 * Loads a price table from a JSON file (`{ "model-name": { "inputPerMillion":
 * N, "outputPerMillion": N }, ... }`). Never throws: a missing file yields an
 * empty table (every model unpriced), and a malformed file is logged and
 * yields an empty table rather than crashing startup.
 */
export function loadPriceTable(path: string): PriceTable {
  if (!existsSync(path)) {
    logger.info('Stats: price table file not found, all models will be recorded as unpriced', { path });
    return {};
  }

  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('price table must be a JSON object');
    }

    const table: PriceTable = {};
    for (const [model, price] of Object.entries(raw as Record<string, unknown>)) {
      if (
        typeof price !== 'object' ||
        price === null ||
        typeof (price as Record<string, unknown>).inputPerMillion !== 'number' ||
        typeof (price as Record<string, unknown>).outputPerMillion !== 'number'
      ) {
        logger.warn('Stats: skipping malformed price table entry', { model });
        continue;
      }
      table[model] = {
        inputPerMillion: (price as Record<string, unknown>).inputPerMillion as number,
        outputPerMillion: (price as Record<string, unknown>).outputPerMillion as number,
      };
    }
    return table;
  } catch (error) {
    logger.warn('Stats: failed to load price table, all models will be recorded as unpriced', {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

/**
 * Pure: computes the estimated cost of a call from its token counts and a
 * model's price. Returns `0` when `price` is `undefined` (the model has no
 * configured price) — callers must check price presence separately (see
 * `isPriced`) to distinguish "free" from "unpriced".
 */
export function computeCost(usage: { inputTokens: number; outputTokens: number }, price: ModelPrice | undefined): number {
  if (!price) return 0;
  return (usage.inputTokens / 1_000_000) * price.inputPerMillion + (usage.outputTokens / 1_000_000) * price.outputPerMillion;
}

/** Pure: whether `model` has a configured price in `table`. */
export function isPriced(model: string, table: PriceTable): boolean {
  return Object.prototype.hasOwnProperty.call(table, model);
}
