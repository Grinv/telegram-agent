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

test('without() excludes the named tools from the returned registry', () => {
  const registry = new ToolRegistry();
  registry.register(fakeTool('a'));
  registry.register(fakeTool('b'));
  registry.register(fakeTool('c'));
  registry.register(fakeTool('d'));

  const filtered = registry.without(['a', 'b']);

  assert.equal(filtered.getDefinitions().length, 2);
  assert.throws(() => filtered.getTool('a'), ToolNotFoundError);
  assert.throws(() => filtered.getTool('b'), ToolNotFoundError);
  assert.equal(filtered.getTool('c'), registry.getTool('c'));
  assert.equal(filtered.getTool('d'), registry.getTool('d'));
  // Original registry is unaffected.
  assert.equal(registry.getDefinitions().length, 4);
});

test('without() reports isEmpty correctly when tools remain or all are excluded', () => {
  const registry = new ToolRegistry();
  registry.register(fakeTool('a'));
  registry.register(fakeTool('b'));

  assert.equal(registry.without(['a']).isEmpty(), false);
  assert.equal(registry.without(['a', 'b']).isEmpty(), true);
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
