// TokenClient tests — focus on ensureAllowance behavior (the main value-add
// over raw ethers). We stub the ethers Contract with a fake so these run
// without an RPC.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TokenClient } from '../src/token.js';

function makeClient({ allowance = 0n, ownerAddr = '0xOWNER' } = {}) {
  const calls = [];
  const fakeContract = {
    allowance: async (owner, spender) => {
      calls.push({ name: 'allowance', args: [owner, spender] });
      return allowance;
    },
    approve: async (spender, amount) => {
      calls.push({ name: 'approve', args: [spender, amount] });
      return { hash: '0xAPPROVE', wait: async () => ({ status: 1 }) };
    },
    balanceOf: async () => 0n,
    name: async () => 'TestToken',
    symbol: async () => 'TEST',
    decimals: async () => 6,
  };
  const client = Object.create(TokenClient.prototype);
  client.address = '0xTOKEN';
  client.contract = fakeContract;
  client.runner = { getAddress: async () => ownerAddr };
  client._metadata = null;
  return { client, calls };
}

test('ensureAllowance: submits approve when current allowance < amount', async () => {
  const { client, calls } = makeClient({ allowance: 100n });
  const tx = await client.ensureAllowance('0xSPENDER', 500n);
  assert.equal(tx.hash, '0xAPPROVE');
  assert.deepEqual(calls.map((c) => c.name), ['allowance', 'approve']);
  assert.equal(calls[0].args[0], '0xOWNER');
  assert.equal(calls[0].args[1], '0xSPENDER');
  assert.equal(calls[1].args[1], 500n);
});

test('ensureAllowance: returns null when allowance already covers amount', async () => {
  const { client, calls } = makeClient({ allowance: 1000n });
  const tx = await client.ensureAllowance('0xSPENDER', 500n);
  assert.equal(tx, null);
  assert.deepEqual(calls.map((c) => c.name), ['allowance']); // no approve tx
});

test('ensureAllowance: accepts explicit owner (e.g. read-only runner)', async () => {
  const { client, calls } = makeClient({ allowance: 0n });
  await client.ensureAllowance('0xSPENDER', 1n, '0xEXPLICIT');
  assert.equal(calls[0].args[0], '0xEXPLICIT');
});

test('getMetadata: caches after first call', async () => {
  const { client } = makeClient();
  const first = await client.getMetadata();
  const second = await client.getMetadata();
  assert.deepEqual(first, { name: 'TestToken', symbol: 'TEST', decimals: 6 });
  assert.strictEqual(first, second, 'second call should return the cached object');
});
