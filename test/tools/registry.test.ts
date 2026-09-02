import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, ToolNotFoundError } from '../../src/tools/registry.js';
import type { Tool } from '../../src/tools/types.js';

function fakeTool(name: string): Tool {
  return {
    name,
    description: `Description for ${name}`,
    parameters: { type: 'object', properties: {} },
    async execute() {
      return { ok: true, output: `${name} ran` };
    },
  };
}

test('register then getTool returns the same tool', () => {
  const registry = new ToolRegistry();
  const tool = fakeTool('my_tool');

  registry.register(tool);

  assert.equal(registry.getTool('my_tool'), tool);
});

test('getTool throws ToolNotFoundError for an unregistered name', () => {
  const registry = new ToolRegistry();

  assert.throws(() => registry.getTool('missing'), ToolNotFoundError);
});

test('isEmpty is true for a fresh registry and false once a tool is registered', () => {
  const registry = new ToolRegistry();

  assert.equal(registry.isEmpty(), true);

  registry.register(fakeTool('a_tool'));

  assert.equal(registry.isEmpty(), false);
});

test('getDefinitions returns the JSON-Schema shape the LLM expects', () => {
  const registry = new ToolRegistry();
  registry.register(fakeTool('a_tool'));

  const definitions = registry.getDefinitions();

  assert.deepEqual(definitions, [
    {
      name: 'a_tool',
      description: 'Description for a_tool',
      parameters: { type: 'object', properties: {} },
    },
  ]);
});
