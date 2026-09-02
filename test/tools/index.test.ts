import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultToolRegistry } from '../../src/tools/index.js';

test('createDefaultToolRegistry registers all four default tools with correct names', () => {
  const registry = createDefaultToolRegistry();

  const names = registry.getDefinitions().map((def) => def.name).sort();

  assert.deepEqual(names, ['execute_command', 'list_files', 'read_file', 'write_file']);
  assert.equal(registry.isEmpty(), false);
});
