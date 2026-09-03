import type { SkillLibrary } from './skills/types.js';

const BASE_INSTRUCTION =
  'You are an assistant integrated with a Telegram bot. You can use tools to run shell ' +
  'commands in an isolated sandbox, read and write files, list files, and spawn sub-agents ' +
  'for independent sub-tasks. Answer the user directly and concisely.';

/**
 * Builds the system instruction text sent with every request: the base
 * instruction plus, when skills are loaded, an index of their names and
 * descriptions (never their bodies — those are fetched on demand via the
 * `read_skill` tool). Omits the skill section entirely when no skills are
 * loaded, rather than including an empty placeholder.
 *
 * Pure and deterministic: the same `skillLibrary` always produces
 * byte-identical output, since a later change relies on this being a stable
 * prefix for prompt-cache reuse (see design.md — Decisions).
 */
export function buildSystemInstruction(skillLibrary?: SkillLibrary): string {
  const skills = skillLibrary?.list() ?? [];
  if (skills.length === 0) {
    return BASE_INSTRUCTION;
  }

  return `${BASE_INSTRUCTION}\n\nAvailable skills — before attempting a task that matches one of these, call read_skill with its exact name FIRST to get the exact steps and commands. Do not guess at commands, URLs, or endpoints on your own when a skill already documents them:\n${skillLibrary!.renderIndex()}`;
}
