import { SqliteStatsRecorder } from './sqlite-recorder.js';
import { StatsReporter } from './reporter.js';
import type { StatsRecorder } from './types.js';

export function createStatsRecorder(dbPath: string, storePrompts: boolean): StatsRecorder {
  return new SqliteStatsRecorder(dbPath, storePrompts);
}

export function createStatsReporter(dbPath: string): StatsReporter {
  return new StatsReporter(dbPath);
}
