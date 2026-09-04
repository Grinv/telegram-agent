import type { AnalysisStats, SummaryStats, TaskTimeline, ToolTokenShare } from './dashboard-queries.js';

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/** Recorded tool names are never absent, but can be an empty string; render that case legibly rather than as a blank cell. */
function displayToolName(toolName: string): string {
  return toolName.length > 0 ? toolName : '(unnamed tool)';
}

function renderToolShares(toolShares: ToolTokenShare[]): string[] {
  const lines: string[] = ['| Tool | Tokens | Share |', '| --- | --- | --- |'];
  for (const t of toolShares) {
    lines.push(`| ${displayToolName(t.toolName)} | ${t.tokens} | ${pct(t.share)} |`);
  }
  return lines;
}

/** Renders the summary view. `null` input renders a "no data" message rather than zeroes. */
export function renderSummary(stats: SummaryStats | null): string {
  if (!stats) return '# Stats Summary\n\nNo data.\n';

  const sections: string[] = ['# Stats Summary', '', `Tasks completed: ${stats.taskCount}`, ''];

  sections.push('## Tokens', '');
  sections.push('| Metric | Total |', '| --- | --- |');
  sections.push(`| Input tokens | ${stats.inputTokens} |`);
  sections.push(`| Output tokens | ${stats.outputTokens} |`);
  sections.push(`| Cached tokens | ${stats.cachedTokens} |`);
  sections.push('');
  sections.push(`Cache hit rate: ${stats.cacheHitRate === null ? 'unavailable (no calls reported cache statistics)' : pct(stats.cacheHitRate)}`);
  sections.push('');

  sections.push('## Cost', '');
  const costNote = stats.costPartial ? ' (partial — some activity used unpriced models)' : '';
  sections.push(`Estimated cost: $${stats.estimatedCost.toFixed(6)}${costNote}`);
  sections.push('');

  sections.push('## Per-task averages', '');
  sections.push('| Metric | Average |', '| --- | --- |');
  sections.push(`| Tokens | ${stats.avgTokensPerTask.toFixed(1)} |`);
  sections.push(`| Turns | ${stats.avgTurnsPerTask.toFixed(1)} |`);
  sections.push(`| Tool calls | ${stats.avgToolCallsPerTask.toFixed(1)} |`);
  sections.push('');

  sections.push('## Tools by token share', '');
  if (stats.toolShares.length > 0) {
    sections.push(...renderToolShares(stats.toolShares));
  } else {
    sections.push('No tool calls recorded.');
  }
  sections.push('');

  return sections.join('\n');
}

/** Renders the timeline view for one task. `null` timeline renders a "not found" message. */
export function renderTimeline(timeline: TaskTimeline | null, taskId: number): string {
  if (!timeline) return `# Task Timeline: ${taskId}\n\nTask not found.\n`;

  const sections: string[] = [`# Task Timeline: ${taskId}`, ''];

  for (const turn of timeline.turns) {
    sections.push(`## Turn ${turn.turnNumber} — ${turn.model} (input ${turn.inputTokens} / output ${turn.outputTokens} tokens)`, '');
    if (turn.toolCalls.length > 0) {
      for (const call of turn.toolCalls) {
        sections.push(`- ${displayToolName(call.toolName)} — ${call.ok ? 'ok' : 'failed'}, result size ${call.resultSize} (${call.outputTokens} tokens)`);
      }
    } else {
      sections.push('No tool calls in this turn.');
    }
    sections.push('');
  }

  return sections.join('\n');
}

/** Renders the analysis view. `null` input renders a "no data" message rather than zeroes. */
export function renderAnalysis(stats: AnalysisStats | null): string {
  if (!stats) return '# Stats Analysis\n\nNo data.\n';

  const sections: string[] = ['# Stats Analysis', ''];

  sections.push('## Tools by token share', '');
  if (stats.toolShares.length > 0) {
    sections.push(...renderToolShares(stats.toolShares));
  } else {
    sections.push('No tool calls recorded.');
  }
  sections.push('');

  sections.push('## Most expensive turn', '');
  if (stats.mostExpensiveTurn) {
    const t = stats.mostExpensiveTurn;
    sections.push(`Task ${t.taskId}, turn ${t.turnNumber} (${t.model}): ${t.inputTokens} input tokens`);
  } else {
    sections.push('No calls recorded.');
  }
  sections.push('');

  sections.push(
    '## Input by content category',
    '',
    "Measured over the whole request, including the tool definitions advertised to the model - not only the message list - so figures here are a corrected measurement, not a change in the agent's behaviour, compared to any earlier report of these figures.",
    ''
  );
  const c = stats.categoryShares;
  if (c.totalTokens > 0) {
    sections.push('| Category | Tokens | Share |', '| --- | --- | --- |');
    sections.push(`| Instructions | ${c.instructionTokens} | ${pct(c.instructionTokens / c.totalTokens)} |`);
    sections.push(`| Tool definitions | ${c.toolDefinitionTokens} | ${pct(c.toolDefinitionTokens / c.totalTokens)} |`);
    sections.push(`| User request | ${c.userRequestTokens} | ${pct(c.userRequestTokens / c.totalTokens)} |`);
    sections.push(`| Conversation | ${c.conversationTokens} | ${pct(c.conversationTokens / c.totalTokens)} |`);
    sections.push(`| Tool output | ${c.toolOutputTokens} | ${pct(c.toolOutputTokens / c.totalTokens)} |`);
  } else {
    sections.push('No data.');
  }
  if (c.excludedRows > 0) {
    sections.push(
      '',
      `Note: ${c.excludedRows} call(s) recorded before category attribution existed, or under the previous (tool-definition-blind) attribution, are excluded from this breakdown.`
    );
  }
  sections.push('');

  sections.push(
    '## Repeated vs. new input',
    '',
    "Measured over the whole request, including the tool definitions - a constant block resent on every call after a task's first counts as repeated - so this proportion is a corrected measurement, not a change in the agent's behaviour, compared to any earlier report of it.",
    ''
  );
  const r = stats.repeatedVsNew;
  const repeatedNewTotal = r.repeatedTokens + r.newTokens;
  if (repeatedNewTotal > 0) {
    sections.push(`Repeated: ${r.repeatedTokens} tokens (${pct(r.repeatedTokens / repeatedNewTotal)})`);
    sections.push(`New: ${r.newTokens} tokens (${pct(r.newTokens / repeatedNewTotal)})`);
  } else {
    sections.push('No data.');
  }
  if (r.excludedRows > 0) {
    sections.push(
      '',
      `Note: ${r.excludedRows} call(s) recorded before repeated-input measurement existed, or under the previous (tool-definition-blind) attribution, are excluded from this breakdown.`
    );
  }
  sections.push('');

  return sections.join('\n');
}
