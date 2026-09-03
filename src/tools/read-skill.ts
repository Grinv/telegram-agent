import type { Tool, ToolContext } from './types.js';

const PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Exact skill name, as shown in the skill index' },
  },
  required: ['name'],
};

/**
 * `read_skill` — returns a loaded skill's full instruction body by name.
 * Answers from the in-memory library carried on `context.skillLibrary`
 * (populated at startup; see `src/skills/`) rather than `execInContainer`,
 * since skill files live in the repository and are not present inside any
 * sandbox container.
 */
export const readSkillTool: Tool = {
  name: 'read_skill',
  description: 'Retrieve the full instructions for one skill, by the exact name shown in the skill index.',
  parameters: PARAMETERS,
  async execute(context: ToolContext, args: Record<string, unknown>) {
    const name = args.name;
    if (typeof name !== 'string') {
      return { ok: false, error: 'read_skill requires a string "name" argument' };
    }

    if (!context.skillLibrary) {
      return { ok: false, error: 'No skills are available in this context' };
    }

    const skill = context.skillLibrary.get(name);
    if (!skill) {
      const available = context.skillLibrary.list().map((s) => s.name);
      return {
        ok: false,
        error: `Unknown skill "${name}". Available skills: ${available.length > 0 ? available.join(', ') : '(none)'}`,
      };
    }

    return { ok: true, output: skill.body };
  },
};
