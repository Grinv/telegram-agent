import { DatabaseSync } from 'node:sqlite';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { migrate } from './migrations.js';

interface ModelTotalsRow {
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  calls: number;
}

interface RoleBreakdownRow {
  role: string;
  tokens: number;
}

interface LatencyRow {
  model: string;
  avg_ms: number;
  'MIN(latency_ms)': number;
  'MAX(latency_ms)': number;
}

interface SuccessRateRow {
  total: number;
  succeeded: number;
  success_pct: number | null;
}

interface ToolUsageRow {
  tool_name: string;
  calls: number;
  succeeded: number;
  avg_ms: number;
}

/** Reads the stats SQLite database and renders a Markdown report. */
export class StatsReporter {
  constructor(private readonly dbPath: string) {}

  async generateReport(outputPath: string): Promise<void> {
    await mkdir(dirname(this.dbPath), { recursive: true });
    const db = new DatabaseSync(this.dbPath);
    try {
      migrate(db);

      const modelTotals = db
        .prepare(
          `SELECT model,
                  SUM(prompt_tokens) AS input_tokens,
                  SUM(completion_tokens) AS output_tokens,
                  SUM(prompt_tokens + completion_tokens) AS total_tokens,
                  COUNT(*) AS calls
           FROM llm_calls GROUP BY model ORDER BY total_tokens DESC`
        )
        .all() as unknown as ModelTotalsRow[];

      const roleBreakdown = db
        .prepare(`SELECT role, SUM(prompt_tokens + completion_tokens) AS tokens FROM llm_calls GROUP BY role`)
        .all() as unknown as RoleBreakdownRow[];

      const latencyByModel = db
        .prepare(
          `SELECT model, AVG(latency_ms) AS avg_ms, MIN(latency_ms), MAX(latency_ms)
           FROM llm_calls GROUP BY model`
        )
        .all() as unknown as LatencyRow[];

      const successRate = db
        .prepare(
          `SELECT COUNT(*) AS total, SUM(ok) AS succeeded, ROUND(100.0 * SUM(ok) / COUNT(*), 1) AS success_pct
           FROM messages`
        )
        .get() as unknown as SuccessRateRow | undefined;

      const toolUsage = db
        .prepare(
          `SELECT tool_name, COUNT(*) AS calls, SUM(ok) AS succeeded, AVG(latency_ms) AS avg_ms
           FROM tool_calls GROUP BY tool_name`
        )
        .all() as unknown as ToolUsageRow[];

      const hasData = modelTotals.length > 0 || (successRate?.total ?? 0) > 0 || toolUsage.length > 0;

      const markdown = hasData
        ? renderReport({ modelTotals, roleBreakdown, latencyByModel, successRate, toolUsage })
        : '# Stats Report\n\nNo data.\n';

      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, markdown, 'utf8');
    } finally {
      db.close();
    }
  }
}

function renderReport(data: {
  modelTotals: ModelTotalsRow[];
  roleBreakdown: RoleBreakdownRow[];
  latencyByModel: LatencyRow[];
  successRate: SuccessRateRow | undefined;
  toolUsage: ToolUsageRow[];
}): string {
  const sections: string[] = ['# Stats Report', ''];

  sections.push('## Per-model token totals', '');
  sections.push('| Model | Input tokens | Output tokens | Total tokens | Calls |');
  sections.push('| --- | --- | --- | --- | --- |');
  for (const row of data.modelTotals) {
    sections.push(`| ${row.model} | ${row.input_tokens} | ${row.output_tokens} | ${row.total_tokens} | ${row.calls} |`);
  }
  sections.push('');

  sections.push('## Per-role token breakdown', '');
  sections.push('| Role | Tokens |');
  sections.push('| --- | --- |');
  for (const row of data.roleBreakdown) {
    sections.push(`| ${row.role} | ${row.tokens} |`);
  }
  sections.push('');

  sections.push('## Latency per model', '');
  sections.push('| Model | Avg (ms) | Min (ms) | Max (ms) |');
  sections.push('| --- | --- | --- | --- |');
  for (const row of data.latencyByModel) {
    const min = row['MIN(latency_ms)'];
    const max = row['MAX(latency_ms)'];
    sections.push(`| ${row.model} | ${Math.round(row.avg_ms)} | ${min} | ${max} |`);
  }
  sections.push('');

  sections.push('## Success rate', '');
  if (data.successRate && data.successRate.total > 0) {
    sections.push('| Total messages | Succeeded | Success % |');
    sections.push('| --- | --- | --- |');
    sections.push(`| ${data.successRate.total} | ${data.successRate.succeeded} | ${data.successRate.success_pct} |`);
  } else {
    sections.push('No messages recorded.');
  }
  sections.push('');

  sections.push('## Tool usage', '');
  if (data.toolUsage.length > 0) {
    sections.push('| Tool | Calls | Succeeded | Avg latency (ms) |');
    sections.push('| --- | --- | --- | --- |');
    for (const row of data.toolUsage) {
      sections.push(`| ${row.tool_name} | ${row.calls} | ${row.succeeded} | ${Math.round(row.avg_ms)} |`);
    }
  } else {
    sections.push('No tool calls recorded.');
  }
  sections.push('');

  return sections.join('\n');
}
