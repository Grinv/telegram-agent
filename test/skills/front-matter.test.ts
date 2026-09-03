import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontMatter } from '../../src/skills/front-matter.js';

test('well-formed input yields name, description, and body', () => {
  const text = [
    '---',
    'name: weather',
    'description: Look up current weather for a location.',
    '---',
    'Run `curl wttr.in`.',
    '',
  ].join('\n');

  const result = parseFrontMatter(text);

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.name, 'weather');
  assert.equal(result.description, 'Look up current weather for a location.');
  assert.equal(result.body, 'Run `curl wttr.in`.\n');
});

test('missing name field fails', () => {
  const text = ['---', 'description: no name here', '---', 'body'].join('\n');

  const result = parseFrontMatter(text);

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.match(result.reason, /name/i);
});

test('missing description field fails', () => {
  const text = ['---', 'name: no-description', '---', 'body'].join('\n');

  const result = parseFrontMatter(text);

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.match(result.reason, /description/i);
});

test('absent front matter entirely fails', () => {
  const text = '# Just a markdown file\n\nNo front matter here at all.\n';

  const result = parseFrontMatter(text);

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.match(result.reason, /---/);
});

test('body content containing --- is not truncated', () => {
  const text = [
    '---',
    'name: has-hr',
    'description: A skill whose body uses a markdown horizontal rule.',
    '---',
    'Intro paragraph.',
    '',
    '---',
    '',
    'Section after the horizontal rule.',
    '',
  ].join('\n');

  const result = parseFrontMatter(text);

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(
    result.body,
    ['Intro paragraph.', '', '---', '', 'Section after the horizontal rule.', ''].join('\n')
  );
});

test('a front matter line that is not "key: value" fails', () => {
  const text = ['---', 'name: bad', 'not a key value line', 'description: x', '---', 'body'].join('\n');

  const result = parseFrontMatter(text);

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
});
