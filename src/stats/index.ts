import { SqliteStatsRecorder } from './sqlite-recorder.js';
import { StatsReporter } from './reporter.js';
import type { PriceTable } from './pricing.js';
import type { StatsRecorder } from './types.js';

export { loadPriceTable } from './pricing.js';

export function createStatsRecorder(dbPath: string, storePrompts: boolean, priceTable: PriceTable = {}): StatsRecorder {
  return new SqliteStatsRecorder(dbPath, storePrompts, priceTable);
}

export function createStatsReporter(dbPath: string): StatsReporter {
  return new StatsReporter(dbPath);
}
