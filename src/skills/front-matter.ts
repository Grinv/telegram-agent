const DELIMITER = '---';

export interface FrontMatterSuccess {
  ok: true;
  name: string;
  description: string;
  body: string;
}

export interface FrontMatterFailure {
  ok: false;
  /** Human-readable reason naming exactly what was missing or wrong. */
  reason: string;
}

export type FrontMatterResult = FrontMatterSuccess | FrontMatterFailure;

/** Strips a single trailing "\r" so both LF and CRLF line endings compare equal. */
function stripTrailingCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/**
 * Parses a skill file's raw text into its front matter (`name`, `description`)
 * and body. Supports only the minimal shape the project needs: a line that is
 * exactly `---`, then simple `key: value` scalar lines, then a line that is
 * exactly `---`, then the body is everything after that closing line.
 *
 * Deliberately strict, per project convention (no YAML parser): anything that
 * does not fit this shape — no opening delimiter, no closing delimiter, a
 * front-matter line that isn't `key: value`, or a missing `name`/`description`
 * — is a failure, never a silently partial result. The closing delimiter is
 * the first line equal to `---` found while scanning from the top, so a
 * literal `---` inside the body (e.g. a markdown horizontal rule) is never
 * mistaken for it and the body is never truncated.
 */
export function parseFrontMatter(text: string): FrontMatterResult {
  const lines = text.split('\n');

  if (lines.length === 0 || stripTrailingCr(lines[0]) !== DELIMITER) {
    return { ok: false, reason: `missing opening "${DELIMITER}" front matter delimiter on the first line` };
  }

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (stripTrailingCr(lines[i]) === DELIMITER) {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    return { ok: false, reason: `missing closing "${DELIMITER}" front matter delimiter` };
  }

  const fields: Record<string, string> = {};
  for (let i = 1; i < closingIndex; i++) {
    const raw = stripTrailingCr(lines[i]);
    if (raw.trim() === '') continue;

    const separatorIndex = raw.indexOf(':');
    if (separatorIndex === -1) {
      return { ok: false, reason: `front matter line ${i + 1} is not a "key: value" scalar: "${raw}"` };
    }

    const key = raw.slice(0, separatorIndex).trim();
    const value = raw.slice(separatorIndex + 1).trim();
    if (key === '') {
      return { ok: false, reason: `front matter line ${i + 1} is not a "key: value" scalar: "${raw}"` };
    }
    fields[key] = value;
  }

  if (!fields.name) {
    return { ok: false, reason: 'front matter is missing required field "name"' };
  }
  if (!fields.description) {
    return { ok: false, reason: 'front matter is missing required field "description"' };
  }

  const body = lines.slice(closingIndex + 1).join('\n');

  return { ok: true, name: fields.name, description: fields.description, body };
}
