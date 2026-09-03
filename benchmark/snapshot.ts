import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BenchmarkRunResult, TaskExecutionResult } from './runner.js';

/**
 * A completed benchmark run, saved under a caller-supplied label. Records
 * the conditions it was produced under (`model`, `taskSetId`) so a snapshot
 * produced under different conditions can be recognised as not comparable
 * to another (see `compare.ts` and specs/agent-benchmark/spec.md —
 * "Snapshot records its conditions").
 */
export interface Snapshot {
  label: string;
  createdAt: string;
  model: string;
  taskSetId: string;
  executions: TaskExecutionResult[];
}

/** Pure: wraps a run's result into a labelled, timestamped snapshot. */
export function buildSnapshot(label: string, runResult: BenchmarkRunResult): Snapshot {
  return {
    label,
    createdAt: new Date().toISOString(),
    model: runResult.model,
    taskSetId: runResult.taskSetId,
    executions: runResult.executions,
  };
}

/** Replaces anything that isn't safe in a filename with "-". */
function sanitizeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9._-]/g, '-');
}

/** The path a snapshot labelled `label` is (or would be) written to under `dir`. */
export function snapshotPath(dir: string, label: string): string {
  return join(dir, `${sanitizeLabel(label)}.json`);
}

/** Writes `snapshot` as `<dir>/<label>.json`, creating `dir` if needed, and returns the path written. */
export async function writeSnapshot(snapshot: Snapshot, dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = snapshotPath(dir, snapshot.label);
  await writeFile(path, JSON.stringify(snapshot, null, 2), 'utf8');
  return path;
}

/** Reads a snapshot previously written by `writeSnapshot`. */
export async function readSnapshot(path: string): Promise<Snapshot> {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as Snapshot;
}
