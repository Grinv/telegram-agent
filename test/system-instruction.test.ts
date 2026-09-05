import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemInstruction } from '../src/system-instruction.js';
import type { Skill, SkillLibrary } from '../src/skills/types.js';

function fakeLibrary(skills: Skill[]): SkillLibrary {
  return {
    list: () => skills,
    get: (name: string) => skills.find((s) => s.name === name),
    renderIndex: () => skills.map((s) => `- ${s.name}: ${s.description}`).join('\n'),
  };
}

test('with skills loaded, the instruction names each one', () => {
  const library = fakeLibrary([
    { name: 'weather', description: 'Look up the weather.', body: 'body' },
    { name: 'morning-briefing', description: 'Run the morning routine.', body: 'body' },
  ]);

  const instruction = buildSystemInstruction(library);

  assert.match(instruction, /weather/);
  assert.match(instruction, /Look up the weather\./);
  assert.match(instruction, /morning-briefing/);
  assert.match(instruction, /Run the morning routine\./);
});

test('with an empty library, the instruction contains no skill section and no placeholder', () => {
  const instruction = buildSystemInstruction(fakeLibrary([]));

  assert.doesNotMatch(instruction, /skill/i);
});

test('with no library at all, the instruction contains no skill section', () => {
  const instruction = buildSystemInstruction(undefined);

  assert.doesNotMatch(instruction, /skill/i);
  assert.ok(instruction.length > 0);
});

test('the instruction keeps its behavioural guidance and capability framing', () => {
  const instruction = buildSystemInstruction(undefined);

  // This instruction is deliberately left untrimmed - see notes.md, "Reducing
  // the agent's instructions - DROPPED": two different trims each measurably
  // broke a different benchmark task on qwen2.5, so the full text is kept
  // even though it repeats some of what the tool definitions also say.
  assert.match(instruction, /tools/i, 'the general capability sentence is retained');
  assert.match(instruction, /answer the user/i, 'behavioural guidance is retained');
});

test('with skills loaded, the direction to consult a matching skill first is retained', () => {
  const library = fakeLibrary([{ name: 'weather', description: 'Look up the weather.', body: 'body' }]);

  const instruction = buildSystemInstruction(library);

  assert.match(instruction, /read_skill/);
  assert.match(instruction, /before attempting/i);
});

test('calling it twice with the same library returns byte-identical text', () => {
  const library = fakeLibrary([{ name: 'weather', description: 'Look up the weather.', body: 'body' }]);

  const first = buildSystemInstruction(library);
  const second = buildSystemInstruction(library);

  assert.equal(first, second);
});
