import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundToolResult } from '../../src/context-management/tool-result-limit.js';

test('a result within the limit is returned unchanged, with no truncation indication', () => {
  const result = { ok: true, output: 'short output' };

  const bounded = boundToolResult(result, 100);

  assert.deepEqual(bounded, { ok: true, output: 'short output' });
  assert.equal('truncated' in bounded, false);
});

test('an oversized successful result is truncated and states the original size', () => {
  const output = 'x'.repeat(500);

  const bounded = boundToolResult({ ok: true, output }, 100);

  assert.equal(bounded.truncated, true);
  assert.ok(bounded.output!.length <= 100 + 60, 'bounded output should be roughly within the limit plus marker overhead');
  assert.match(bounded.output!, /500 characters/);
});

test('truncation preserves the beginning and the end of the original text', () => {
  const output = `HEAD${'x'.repeat(500)}TAIL`;

  const bounded = boundToolResult({ ok: true, output }, 100);

  assert.ok(bounded.output!.startsWith('HEAD'));
  assert.ok(bounded.output!.endsWith('TAIL'));
});

test('an oversized error is truncated the same way as an oversized output', () => {
  const error = 'e'.repeat(500);

  const bounded = boundToolResult({ ok: false, error }, 100);

  assert.equal(bounded.truncated, true);
  assert.match(bounded.error!, /500 characters/);
});

test('an already-compressed result keeps the compressed flag when also truncated', () => {
  const output = 'x'.repeat(500);

  const bounded = boundToolResult({ ok: true, output, compressed: true }, 100);

  assert.equal(bounded.compressed, true);
  assert.equal(bounded.truncated, true);
});

test('a result with no output/error field (e.g. a bare ok:true) is returned unchanged', () => {
  const result = { ok: true };

  const bounded = boundToolResult(result, 100);

  assert.deepEqual(bounded, { ok: true });
});
