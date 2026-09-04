import { SqliteStatsRecorder } from './sqlite-recorder.js';
import { StatsReporter } from './reporter.js';
import { CompositeStatsRecorder } from './composite-recorder.js';
import { createOtelExportRecorder } from './otel-sdk.js';
import type { PriceTable } from './pricing.js';
import type { StatsRecorder } from './types.js';

export { loadPriceTable } from './pricing.js';

export function createStatsRecorder(dbPath: string, storePrompts: boolean, priceTable: PriceTable = {}): StatsRecorder {
  return new SqliteStatsRecorder(dbPath, storePrompts, priceTable);
}

export function createStatsReporter(dbPath: string): StatsReporter {
  return new StatsReporter(dbPath);
}

export interface ConfiguredStatsRecorderConfig {
  dbPath: string;
  storePrompts: boolean;
  priceTable: PriceTable;
  /** OTLP endpoint to export traces to. Unset composes no exporter, so nothing is exported and no OTel SDK is started (see openspec/specs/agent-stats/spec.md - "Export is off unless an operator configures a destination"). */
  otelEndpoint?: string;
}

/**
 * Builds the `StatsRecorder` the app actually uses: the local SQLite
 * recorder alone, or - when an OTLP endpoint is configured - that recorder
 * composed with the OTel exporter behind `CompositeStatsRecorder`, so local
 * recording is identical either way (see design.md - Decisions).
 */
export function createConfiguredStatsRecorder(
  config: ConfiguredStatsRecorderConfig
): { recorder: StatsRecorder; shutdown: () => Promise<void> } {
  const sqliteRecorder = createStatsRecorder(config.dbPath, config.storePrompts, config.priceTable);

  if (!config.otelEndpoint) {
    return { recorder: sqliteRecorder, shutdown: () => Promise.resolve() };
  }

  const { recorder: otelRecorder, shutdown } = createOtelExportRecorder({
    endpoint: config.otelEndpoint,
    storePrompts: config.storePrompts,
    priceTable: config.priceTable,
  });

  return { recorder: new CompositeStatsRecorder([sqliteRecorder, otelRecorder]), shutdown };
}
