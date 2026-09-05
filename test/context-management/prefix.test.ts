import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildRequestPrefix } from '../../src/context-management/prefix.js';
import { createDefaultToolRegistry } from '../../src/tools/index.js';
import type { Skill, SkillLibrary } from '../../src/skills/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function fakeLibrary(skills: Skill[]): SkillLibrary {
  return {
    list: () => skills,
    get: (name: string) => skills.find((s) => s.name === name),
    renderIndex: () => skills.map((s) => `- ${s.name}: ${s.description}`).join('\n'),
  };
}

test('two prefixes assembled under the same configuration, in the same process, are byte-identical', () => {
  const registry = createDefaultToolRegistry();
  const library = fakeLibrary([{ name: 'weather', description: 'Look up the weather.', body: 'body' }]);

  const first = buildRequestPrefix(registry, library);
  const second = buildRequestPrefix(registry, library);

  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('the prefix is byte-identical across two separate process runs (catches Map iteration-order variation)', () => {
  const fixture = join(__dirname, 'fixtures', 'print-prefix.ts');

  const first = execFileSync('node', ['--import', 'tsx', fixture], { encoding: 'utf8' });
  const second = execFileSync('node', ['--import', 'tsx', fixture], { encoding: 'utf8' });

  assert.equal(first, second);
  assert.ok(first.length > 0);
});

test('the tool definitions in the prefix keep the registry\'s registration order', () => {
  const registry = createDefaultToolRegistry();

  const prefix = buildRequestPrefix(registry, undefined);

  assert.deepEqual(
    prefix.tools.map((t) => t.name),
    registry.getDefinitions().map((t) => t.name),
  );
});

test('adding a skill changes the prefix, and the changed prefix remains identical across calls made afterwards', () => {
  const registry = createDefaultToolRegistry();
  const before = buildRequestPrefix(registry, fakeLibrary([]));

  const library = fakeLibrary([{ name: 'new-skill', description: 'A new capability.', body: 'body' }]);
  const afterFirst = buildRequestPrefix(registry, library);
  const afterSecond = buildRequestPrefix(registry, library);

  assert.notEqual(JSON.stringify(before), JSON.stringify(afterFirst), 'the prefix reflects the new skill index');
  assert.equal(JSON.stringify(afterFirst), JSON.stringify(afterSecond), 'and stays identical across calls made after the change');
});
