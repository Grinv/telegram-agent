import type { ToolResult } from '../llm/types.js';

/**
 * Truncates `text` to at most `maxLength` characters if it exceeds that
 * length, keeping the beginning and, when there's room, the end - both ends
 * of command output routinely carry the meaningful part (a header up top, an
 * error or summary at the bottom). The inserted marker states the original
 * size so the model can tell a partial result from a complete one rather
 * than reasoning over a silently cut fragment.
 */
function truncateText(text: string, maxLength: number): { text: string; truncated: boolean } {
  if (text.length <= maxLength) {
    return { text, truncated: false };
  }

  const marker = (fullLength: number) => `\n\n[... truncated: original was ${fullLength} characters ...]\n\n`;
  const markerLength = marker(text.length).length;
  const budget = Math.max(0, maxLength - markerLength);
  const headLength = Math.ceil(budget * 0.7);
  const tailLength = budget - headLength;

  const head = text.slice(0, headLength);
  const tail = tailLength > 0 ? text.slice(text.length - tailLength) : '';

  return { text: `${head}${marker(text.length)}${tail}`, truncated: true };
}

/**
 * Applies the configured tool-result size limit to a tool's result,
 * truncating `output` (on success) or `error` (on failure) when it exceeds
 * `maxLength`, and marking the result `truncated: true` when it did. A
 * result within the limit is returned unchanged - no `truncated` field is
 * added - so untouched results are indistinguishable from before this limit
 * existed. `compressed`, if already set by the tool (see
 * `src/tools/execute-command.ts`), is preserved either way.
 */
export function boundToolResult(result: ToolResult, maxLength: number): ToolResult {
  if (result.ok && result.output !== undefined) {
    const bounded = truncateText(result.output, maxLength);
    if (!bounded.truncated) return result;
    return { ...result, output: bounded.text, truncated: true };
  }

  if (!result.ok && result.error !== undefined) {
    const bounded = truncateText(result.error, maxLength);
    if (!bounded.truncated) return result;
    return { ...result, error: bounded.text, truncated: true };
  }

  return result;
}
