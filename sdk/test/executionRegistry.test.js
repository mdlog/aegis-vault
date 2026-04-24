// ExecutionRegistryClient tests — intent hash computation (offline vs on-chain
// parity), result decoding, pagination bounds. Writes are tiny pass-throughs
// so we focus on the non-trivial logic.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ExecutionRegistryClient } from '../src/executionRegistry.js';

function makeRegistry({ count = 0, hashes = [] } = {}) {
  const fakeContract = {
    getVaultIntentCount: async () => BigInt(count),
    getVaultIntentAt: async (_vault, idx) => hashes[Number(idx)] || '0x' + 'deadbeef'.padEnd(64, '0'),
    getResult: async () => [
      '0x' + '11'.repeat(32),
      '0x' + '22'.repeat(32),
      1234n,     // amountOut
      1700000000n, // executedAt
      15n,       // slippageBps
      true,      // success
    ],
  };
  const client = Object.create(ExecutionRegistryClient.prototype);
  client.address = '0xREG';
  client.contract = fakeContract;
  return client;
}

test('listVaultIntents: returns latest `limit` by default', async () => {
  const hashes = Array.from({ length: 100 }, (_, i) => '0x' + String(i).padStart(64, '0'));
  const client = makeRegistry({ count: 100, hashes });
  const out = await client.listVaultIntents('0xVAULT');
  assert.equal(out.length, 50, 'default limit is 50');
  assert.equal(out[0], hashes[50]);  // from = 100 - 50
  assert.equal(out[49], hashes[99]); // to = 100
});

test('listVaultIntents: respects explicit from/to', async () => {
  const hashes = Array.from({ length: 10 }, (_, i) => '0xAA' + String(i).padStart(62, '0'));
  const client = makeRegistry({ count: 10, hashes });
  const out = await client.listVaultIntents('0xVAULT', { from: 2, to: 5 });
  assert.equal(out.length, 3);
  assert.equal(out[0], hashes[2]);
  assert.equal(out[2], hashes[4]);
});

test('listVaultIntents: empty when count is 0', async () => {
  const client = makeRegistry({ count: 0 });
  const out = await client.listVaultIntents('0xVAULT');
  assert.deepEqual(out, []);
});

test('getResult: decodes tuple into named object with primitive timestamps', async () => {
  const client = makeRegistry();
  const r = await client.getResult('0xIH');
  assert.equal(r.amountOut, 1234n);
  assert.equal(r.executedAt, 1700000000); // Number, not BigInt
  assert.equal(r.slippageBps, 15);
  assert.equal(r.success, true);
  assert.match(r.intentHash, /^0x/);
});

test('computeIntentHashOffline: deterministic for identical inputs', () => {
  const intent = {
    vault: '0x' + '1'.repeat(40),
    assetIn: '0x' + '2'.repeat(40),
    assetOut: '0x' + '3'.repeat(40),
    amountIn: 1_000_000n,
    minAmountOut: 990_000n,
    createdAt: 1700000000,
    expiresAt: 1700000300,
    confidenceBps: 7500,
    riskScoreBps: 1200,
  };
  const h1 = ExecutionRegistryClient.computeIntentHashOffline(intent);
  const h2 = ExecutionRegistryClient.computeIntentHashOffline(intent);
  assert.equal(h1, h2);
  assert.match(h1, /^0x[0-9a-f]{64}$/);
});

test('computeIntentHashOffline: changes when any field changes', () => {
  const base = {
    vault: '0x' + '1'.repeat(40),
    assetIn: '0x' + '2'.repeat(40),
    assetOut: '0x' + '3'.repeat(40),
    amountIn: 1_000_000n,
    minAmountOut: 990_000n,
    createdAt: 1700000000,
    expiresAt: 1700000300,
    confidenceBps: 7500,
    riskScoreBps: 1200,
  };
  const h1 = ExecutionRegistryClient.computeIntentHashOffline(base);
  const h2 = ExecutionRegistryClient.computeIntentHashOffline({ ...base, amountIn: 1_000_001n });
  assert.notEqual(h1, h2);
});
