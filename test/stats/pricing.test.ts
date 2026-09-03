import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeCost, isPriced, loadPriceTable } from '../../src/stats/pricing.js';

test('computeCost derives cost from token counts and a configured price', () => {
  const cost = computeCost(
    { inputTokens: 1_000_000, outputTokens: 500_000 },
    { inputPerMillion: 2, outputPerMillion: 4 }
  );
  assert.equal(cost, 1 * 2 + 0.5 * 4);
});

test('computeCost returns 0 for a model with no configured price', () => {
  const cost = computeCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, undefined);
  assert.equal(cost, 0);
});

test('isPriced distinguishes a configured model from one absent from the table', () => {
  const table = { 'qwen2.5': { inputPerMillion: 1, outputPerMillion: 2 } };
  assert.equal(isPriced('qwen2.5', table), true);
  assert.equal(isPriced('some-other-model', table), false);
});

test('changing the price table after computing a cost does not alter the already-computed value', () => {
  const table = { 'qwen2.5': { inputPerMillion: 1, outputPerMillion: 2 } };
  const costBefore = computeCost({ inputTokens: 1_000_000, outputTokens: 0 }, table['qwen2.5']);

  table['qwen2.5'] = { inputPerMillion: 100, outputPerMillion: 200 };

  assert.equal(costBefore, 1, 'the previously computed cost is a plain number, unaffected by later table changes');
});

function tmpFilePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pricing-test-'));
  return join(dir, 'prices.json');
}

test('loadPriceTable reads a valid JSON price table', () => {
  const path = tmpFilePath();
  writeFileSync(path, JSON.stringify({ 'qwen2.5': { inputPerMillion: 0.5, outputPerMillion: 1.5 } }));

  const table = loadPriceTable(path);
  assert.deepEqual(table, { 'qwen2.5': { inputPerMillion: 0.5, outputPerMillion: 1.5 } });
});

test('loadPriceTable returns an empty table when the file does not exist', () => {
  const table = loadPriceTable(join(tmpdir(), 'definitely-does-not-exist-prices.json'));
  assert.deepEqual(table, {});
});

test('loadPriceTable returns an empty table for malformed JSON, without throwing', () => {
  const path = tmpFilePath();
  writeFileSync(path, 'not json');

  assert.doesNotThrow(() => loadPriceTable(path));
  assert.deepEqual(loadPriceTable(path), {});
});

test('loadPriceTable skips a malformed entry but keeps well-formed ones', () => {
  const path = tmpFilePath();
  writeFileSync(
    path,
    JSON.stringify({
      good: { inputPerMillion: 1, outputPerMillion: 2 },
      bad: { inputPerMillion: 'not-a-number' },
    })
  );

  const table = loadPriceTable(path);
  assert.deepEqual(table, { good: { inputPerMillion: 1, outputPerMillion: 2 } });
});
