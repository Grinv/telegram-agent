import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultToolRegistry } from '../../src/tools/index.js';
import { spawnSubagentTool } from '../../src/tools/spawn-subagent.js';
import { spawnSubagentsTool } from '../../src/tools/spawn-subagents.js';
import { readSkillTool } from '../../src/tools/read-skill.js';

interface JsonSchemaProperty {
  type: string;
  description?: string;
}
interface ObjectSchema {
  type: string;
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

test('descriptions that only restate the argument name and type are absent from the default tools', () => {
  const registry = createDefaultToolRegistry();
  const definitions = registry.getDefinitions();

  for (const def of definitions) {
    const schema = def.parameters as ObjectSchema;
    if (def.name === 'read_file') {
      assert.equal(schema.properties.path.description, undefined, 'read_file.path restates its own name/type');
    }
    if (def.name === 'write_file') {
      assert.equal(schema.properties.path.description, undefined);
      assert.equal(schema.properties.content.description, undefined);
    }
    if (def.name === 'list_files') {
      assert.equal(schema.properties.path.description, undefined);
    }
  }
});

test('a description carrying a constraint the model could not infer is kept', () => {
  const readFileSchema = createDefaultToolRegistry().getDefinitions().find((d) => d.name === 'read_file')!
    .parameters as ObjectSchema;
  assert.ok(readFileSchema.properties.start_line.description, 'start_line/end_line carry a "must be given together" constraint');
  assert.ok(readFileSchema.properties.end_line.description);

  const readSkillSchema = readSkillTool.parameters as ObjectSchema;
  assert.match(readSkillSchema.properties.name.description ?? '', /exact/i);

  const spawnSubagentSchema = spawnSubagentTool.parameters as ObjectSchema;
  assert.ok(spawnSubagentSchema.properties.model.description, 'spawn_subagent.model describes optional model selection');

  const spawnSubagentsSchema = spawnSubagentsTool.parameters as ObjectSchema;
  assert.ok(spawnSubagentsSchema.properties.model.description, 'spawn_subagents.model describes optional model selection');
});

test('every default tool keeps its argument names, types, and required arguments', () => {
  const registry = createDefaultToolRegistry();
  const byName = Object.fromEntries(registry.getDefinitions().map((d) => [d.name, d.parameters as ObjectSchema]));

  assert.deepEqual(Object.keys(byName['read_file'].properties).sort(), ['end_line', 'path', 'start_line']);
  assert.deepEqual(byName['read_file'].required, ['path']);
  assert.equal(byName['read_file'].properties.path.type, 'string');

  assert.deepEqual(Object.keys(byName['write_file'].properties).sort(), ['content', 'path']);
  assert.deepEqual(byName['write_file'].required, ['path', 'content']);

  assert.deepEqual(Object.keys(byName['list_files'].properties).sort(), ['path']);
  assert.deepEqual(byName['list_files'].required, ['path']);

  assert.deepEqual(Object.keys(byName['execute_command'].properties).sort(), ['command']);
  assert.deepEqual(byName['execute_command'].required, ['command']);
});

test('spawn_subagents and read_skill keep their argument names, types and required arguments', () => {
  const spawnSubagentsSchema = spawnSubagentsTool.parameters as ObjectSchema;
  assert.deepEqual(Object.keys(spawnSubagentsSchema.properties).sort(), ['model', 'tasks']);
  assert.deepEqual(spawnSubagentsSchema.required, ['tasks']);

  const readSkillSchema = readSkillTool.parameters as ObjectSchema;
  assert.deepEqual(Object.keys(readSkillSchema.properties).sort(), ['name']);
  assert.deepEqual(readSkillSchema.required, ['name']);
});
