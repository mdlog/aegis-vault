import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/config/index.js';

function makeConfig(overrides = {}) {
  return {
    strictMode: false,
    privateKey: '',
    apiKey: '',
    corsAllowedOrigins: [],
    contracts: {
      vaultFactory: '0x1111111111111111111111111111111111111111',
      executionRegistry: '0x2222222222222222222222222222222222222222',
      protocolTreasury: '',
      operatorRegistry: '',
      operatorStaking: '',
      insurancePool: '',
      operatorReputation: '',
      aegisGovernor: '',
    },
    ...overrides,
    contracts: {
      vaultFactory: '0x1111111111111111111111111111111111111111',
      executionRegistry: '0x2222222222222222222222222222222222222222',
      protocolTreasury: '',
      operatorRegistry: '',
      operatorStaking: '',
      insurancePool: '',
      operatorReputation: '',
      aegisGovernor: '',
      ...(overrides.contracts || {}),
    },
  };
}

test('validateConfig accepts a minimal non-strict orchestrator setup', () => {
  const result = validateConfig(makeConfig());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('validateConfig rejects incomplete strict-mode configuration', () => {
  const result = validateConfig(makeConfig({ strictMode: true }));

  assert.equal(result.ok, false);
  assert.match(result.errors.join(' | '), /PRIVATE_KEY missing in STRICT_MODE/);
  assert.match(result.errors.join(' | '), /ORCHESTRATOR_API_KEY missing in STRICT_MODE/);
  assert.match(result.errors.join(' | '), /CORS_ALLOWED_ORIGINS missing in STRICT_MODE/);
  assert.match(result.errors.join(' | '), /OPERATOR_REGISTRY_ADDRESS missing in STRICT_MODE/);
  assert.match(result.errors.join(' | '), /AEGIS_GOVERNOR_ADDRESS missing in STRICT_MODE/);
});

test('validateConfig accepts a fully populated strict-mode configuration', () => {
  const result = validateConfig(makeConfig({
    strictMode: true,
    privateKey: '0xabc',
    apiKey: 'secret',
    corsAllowedOrigins: ['https://app.example.com'],
    contracts: {
      protocolTreasury: '0x3333333333333333333333333333333333333333',
      operatorRegistry: '0x4444444444444444444444444444444444444444',
      operatorStaking: '0x5555555555555555555555555555555555555555',
      insurancePool: '0x6666666666666666666666666666666666666666',
      operatorReputation: '0x7777777777777777777777777777777777777777',
      aegisGovernor: '0x8888888888888888888888888888888888888888',
    },
  }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});
