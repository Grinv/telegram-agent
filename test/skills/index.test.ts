import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSkills } from '../../src/skills/index.js';

function tmpSkillsDir(): string {
  return mkdtempSync(join(tmpdir(), 'skills-test-'));
}

function writeSkill(dir: string, fileName: string, content: string): void {
  writeFileSync(join(dir, fileName), content, 'utf8');
}

function skillFile(name: string, description: string, body = 'Body text.'): string {
  return ['---', `name: ${name}`, `description: ${description}`, '---', body, ''].join('\n');
}

test('three well-formed files all load', () => {
  const dir = tmpSkillsDir();
  try {
    writeSkill(dir, 'a.md', skillFile('alpha', 'The alpha skill.'));
    writeSkill(dir, 'b.md', skillFile('beta', 'The beta skill.'));
    writeSkill(dir, 'c.md', skillFile('gamma', 'The gamma skill.'));

    const library = loadSkills(dir);

    const names = library
      .list()
      .map((s) => s.name)
      .sort();
    assert.deepEqual(names, ['alpha', 'beta', 'gamma']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a non-existent directory yields an empty library without throwing', () => {
  const dir = join(tmpdir(), 'skills-test-does-not-exist-' + Date.now());

  const library = loadSkills(dir);

  assert.deepEqual(library.list(), []);
});

test('a non-existent directory reports the absence in the startup logs rather than treating it as a failure', () => {
  const dir = join(tmpdir(), 'skills-test-does-not-exist-' + Date.now());
  // The project logger (src/logger.ts) writes INFO-level lines via console.log.
  const originalLog = console.log;
  const logs: unknown[][] = [];
  console.log = (...args: unknown[]) => {
    logs.push(args);
  };
  try {
    loadSkills(dir);

    const loggedAbsence = logs.some((args) =>
      args.some((arg) => typeof arg === 'string' && arg.includes(dir))
      || args.some((arg) => typeof arg === 'object' && arg !== null && JSON.stringify(arg).includes(dir))
    );
    assert.ok(loggedAbsence, 'expected the missing skills directory to be reported in the startup logs');
  } finally {
    console.log = originalLog;
  }
});

test('an empty directory yields an empty library', () => {
  const dir = tmpSkillsDir();
  try {
    const library = loadSkills(dir);

    assert.deepEqual(library.list(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two valid files and one missing its description loads two skills and logs the offending filename', () => {
  const dir = tmpSkillsDir();
  // The project logger (src/logger.ts) writes WARN-level lines via console.log, not console.warn.
  const originalLog = console.log;
  const warnings: unknown[][] = [];
  console.log = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    writeSkill(dir, 'good-a.md', skillFile('alpha', 'The alpha skill.'));
    writeSkill(dir, 'good-b.md', skillFile('beta', 'The beta skill.'));
    writeSkill(dir, 'bad.md', ['---', 'name: broken', '---', 'body', ''].join('\n'));

    const library = loadSkills(dir);

    const names = library
      .list()
      .map((s) => s.name)
      .sort();
    assert.deepEqual(names, ['alpha', 'beta']);

    const loggedBadFile = warnings.some((args) =>
      args.some((arg) => typeof arg === 'string' && arg.includes('bad.md'))
      || args.some(
        (arg) => typeof arg === 'object' && arg !== null && JSON.stringify(arg).includes('bad.md')
      )
    );
    assert.ok(loggedBadFile, 'expected a warning naming the malformed file bad.md');
  } finally {
    console.log = originalLog;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two files declaring the same name yield exactly one skill of that name and a logged collision', () => {
  const dir = tmpSkillsDir();
  // The project logger (src/logger.ts) writes WARN-level lines via console.log, not console.warn.
  const originalLog = console.log;
  const warnings: unknown[][] = [];
  console.log = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    writeSkill(dir, 'first.md', skillFile('duplicate', 'The first version.', 'First body.'));
    writeSkill(dir, 'second.md', skillFile('duplicate', 'The second version.', 'Second body.'));

    const library = loadSkills(dir);

    const matches = library.list().filter((s) => s.name === 'duplicate');
    assert.equal(matches.length, 1);

    const loggedCollision = warnings.some((args) =>
      args.some(
        (arg) =>
          (typeof arg === 'string' && arg.toLowerCase().includes('duplicate'))
          || (typeof arg === 'object' && arg !== null && JSON.stringify(arg).includes('duplicate'))
      )
    );
    assert.ok(loggedCollision, 'expected a warning naming the collision');
  } finally {
    console.log = originalLog;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rendered index contains every skill name and description and none of the bodies', () => {
  const dir = tmpSkillsDir();
  try {
    writeSkill(dir, 'a.md', skillFile('alpha', 'The alpha skill.', 'SECRET_ALPHA_BODY'));
    writeSkill(dir, 'b.md', skillFile('beta', 'The beta skill.', 'SECRET_BETA_BODY'));

    const library = loadSkills(dir);
    const index = library.renderIndex();

    assert.match(index, /alpha/);
    assert.match(index, /The alpha skill\./);
    assert.match(index, /beta/);
    assert.match(index, /The beta skill\./);
    assert.doesNotMatch(index, /SECRET_ALPHA_BODY/);
    assert.doesNotMatch(index, /SECRET_BETA_BODY/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
