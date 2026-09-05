import type { ToolDefinition } from '../llm/types.js';
import type { SkillLibrary } from '../skills/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import { buildSystemInstruction } from '../system-instruction.js';

/**
 * The leading, unchanging part of every request: the agent's instructions
 * (including the skill index) and the advertised tool definitions. Both
 * travel to the provider on every call regardless of conversation or tool
 * output, and both must be assembled identically call to call for a
 * provider that reuses a repeated prefix to be able to do so - see
 * design.md, "Prefix stability is a constraint on assembly, not a caching
 * feature we implement". Assembling them through one function, rather than
 * inline at each call site, is what makes that a property of the code
 * rather than a hope: `buildSystemInstruction` is already pure, and
 * `ToolRegistry.getDefinitions()` iterates a `Map` in registration order, so
 * both are deterministic for a given configuration.
 */
export interface RequestPrefix {
  instruction: string;
  tools: ToolDefinition[];
}

/** Assembles the request prefix from the current tool registry and skill library. */
export function buildRequestPrefix(toolRegistry: ToolRegistry, skillLibrary?: SkillLibrary): RequestPrefix {
  return {
    instruction: buildSystemInstruction(skillLibrary),
    tools: toolRegistry.isEmpty() ? [] : toolRegistry.getDefinitions(),
  };
}
