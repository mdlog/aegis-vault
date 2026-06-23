import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(resolve(here, '../../src/strategy/schema-v1.json'), 'utf8'));

test('schema-v1 declares execution.requireTeeAttestation as an optional boolean', () => {
  assert.ok(schema.properties.execution, 'execution block must exist');
  assert.equal(schema.properties.execution.additionalProperties, false);
  assert.equal(schema.properties.execution.properties.requireTeeAttestation.type, 'boolean');
  // execution must NOT be in required[], so legacy manifests still validate
  assert.ok(!(schema.required || []).includes('execution'));
});
