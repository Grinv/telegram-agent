import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../logger.js';
import { parseFrontMatter } from './front-matter.js';
import type { Skill, SkillLibrary } from './types.js';

class InMemorySkillLibrary implements SkillLibrary {
  constructor(private readonly skills: Skill[]) {}

  list(): Skill[] {
    return [...this.skills];
  }

  get(name: string): Skill | undefined {
    return this.skills.find((skill) => skill.name === name);
  }

  renderIndex(): string {
    return this.skills.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n');
  }
}

/**
 * Loads every `*.md` file directly inside `dir` (non-recursive) as a skill.
 * Never throws: a non-existent directory or an unreadable one yields an
 * empty library, a malformed file is skipped and logged by name, and a name
 * collision keeps the first-loaded skill and logs the collision. Files are
 * processed in sorted order so which one "wins" a collision is deterministic.
 */
export function loadSkills(dir: string): SkillLibrary {
  if (!existsSync(dir)) {
    logger.info('Skills: directory not found, starting with no skills available', { dir });
    return new InMemorySkillLibrary([]);
  }

  let fileNames: string[];
  try {
    fileNames = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    logger.warn('Skills: failed to read skills directory, loading no skills', {
      dir,
      error: error instanceof Error ? error.message : String(error),
    });
    return new InMemorySkillLibrary([]);
  }

  const byName = new Map<string, Skill>();
  for (const fileName of fileNames) {
    const filePath = join(dir, fileName);

    let text: string;
    try {
      text = readFileSync(filePath, 'utf8');
    } catch (error) {
      logger.warn('Skills: failed to read skill file, skipping it', {
        file: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const result = parseFrontMatter(text);
    if (!result.ok) {
      logger.warn('Skills: malformed skill file, skipping it', { file: filePath, reason: result.reason });
      continue;
    }

    if (byName.has(result.name)) {
      logger.warn('Skills: duplicate skill name, keeping the first file loaded and discarding this one', {
        name: result.name,
        file: filePath,
      });
      continue;
    }

    byName.set(result.name, { name: result.name, description: result.description, body: result.body });
  }

  return new InMemorySkillLibrary([...byName.values()]);
}
