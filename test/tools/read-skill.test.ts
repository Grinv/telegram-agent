import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSkillTool } from '../../src/tools/read-skill.js';
import type { ToolContext } from '../../src/tools/types.js';
import type { Skill, SkillLibrary } from '../../src/skills/types.js';

function fakeLibrary(skills: Skill[]): SkillLibrary {
  return {
    list: () => skills,
    get: (name: string) => skills.find((s) => s.name === name),
    renderIndex: () => skills.map((s) => `- ${s.name}: ${s.description}`).join('\n'),
  };
}

function throwingExecInContainer(): ToolContext['execInContainer'] {
  return async () => {
    throw new Error('execInContainer must not be called by read_skill');
  };
}

test('requesting a loaded skill returns its full body', async () => {
  const library = fakeLibrary([{ name: 'weather', description: 'Look up the weather.', body: 'Full weather instructions.' }]);
  const context: ToolContext = { execInContainer: throwingExecInContainer(), skillLibrary: library };

  const result = await readSkillTool.execute(context, { name: 'weather' });

  assert.deepEqual(result, { ok: true, output: 'Full weather instructions.' });
});

test('requesting an unknown skill name returns a failure naming the request and listing available names', async () => {
  const library = fakeLibrary([
    { name: 'weather', description: 'Look up the weather.', body: 'body' },
    { name: 'morning-briefing', description: 'Run the routine.', body: 'body' },
  ]);
  const context: ToolContext = { execInContainer: throwingExecInContainer(), skillLibrary: library };

  const result = await readSkillTool.execute(context, { name: 'nonexistent' });

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /nonexistent/);
  assert.match(result.error ?? '', /weather/);
  assert.match(result.error ?? '', /morning-briefing/);
});

test('rejects a non-string name argument', async () => {
  const context: ToolContext = { execInContainer: throwingExecInContainer(), skillLibrary: fakeLibrary([]) };

  const result = await readSkillTool.execute(context, { name: 42 });

  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /string "name"/);
});

test('succeeds without calling execInContainer, even when it would throw (no sandbox dependency)', async () => {
  const library = fakeLibrary([{ name: 'weather', description: 'Look up the weather.', body: 'Full weather instructions.' }]);
  const context: ToolContext = { execInContainer: throwingExecInContainer(), skillLibrary: library };

  const result = await readSkillTool.execute(context, { name: 'weather' });

  assert.equal(result.ok, true);
});

test('returns a failure rather than throwing when no skill library is present in context', async () => {
  const context: ToolContext = { execInContainer: throwingExecInContainer() };

  const result = await readSkillTool.execute(context, { name: 'weather' });

  assert.equal(result.ok, false);
});
