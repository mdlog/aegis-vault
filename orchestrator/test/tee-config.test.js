import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../src/config/index.js';

test('teeAttestation config has sane defaults', () => {
  assert.equal(config.teeAttestation.automataAddress, '0xE26E11B257856B0bEBc4C759aaBDdea72B64351F');
  assert.equal(config.teeAttestation.automataRpc, 'https://rpc.ata.network');
  assert.equal(config.teeAttestation.cacheTtlMs, 3_600_000);
  assert.equal(config.teeAttestation.fetchTimeoutMs, 60_000);
});
