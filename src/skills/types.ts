/** A single skill: authored instructions the model may retrieve on demand. */
export interface Skill {
  name: string;
  description: string;
  body: string;
}

/**
 * The loaded set of skills for one process lifetime. Discovery happens once
 * at startup (see `loadSkills`); this interface only exposes read access.
 */
export interface SkillLibrary {
  /** All loaded skills, in no particular guaranteed order. */
  list(): Skill[];
  /** Looks up a skill by exact name, or `undefined` if none matches. */
  get(name: string): Skill | undefined;
  /** Renders the index: every skill's name and description, no bodies. */
  renderIndex(): string;
}
