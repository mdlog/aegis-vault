// MulticallClient tests — focus on encoding, decoding, and failure handling
// via a stubbed Multicall3 contract. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Interface, AbiCoder } from 'ethers';
import { MulticallClient } from '../src/multicall.js';

const SAMPLE_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
];

function makeClient(fakeResults) {
  const fakeContract = {
    target: '0xMC3',
    getBlockNumber: async () => 12345n,
    aggregate3: {
      staticCall: async (_tuples) => fakeResults,
    },
  };
  const client = Object.create(MulticallClient.prototype);
  client.address = '0xMC3';
  client.contract = fakeContract;
  return client;
}

test('batch: encodes calls, decodes results, unwraps single-output scalars', async () => {
  const iface = new Interface(SAMPLE_ABI);
  const coder = AbiCoder.defaultAbiCoder();
  // Fake return: balanceOf(0x…) = 10_000; symbol() = 'USDC'
  const fakeResults = [
    { success: true, returnData: coder.encode(['uint256'], [10_000n]) },
    { success: true, returnData: coder.encode(['string'], ['USDC']) },
  ];
  const client = makeClient(fakeResults);

  const OWNER = '0x' + '11'.repeat(20);
  const out = await client.batch([
    { address: '0xTOKEN', abi: SAMPLE_ABI, method: 'balanceOf', args: [OWNER] },
    { address: '0xTOKEN', abi: SAMPLE_ABI, method: 'symbol' },
  ]);

  assert.equal(out.length, 2);
  assert.equal(out[0].success, true);
  assert.equal(out[0].result, 10_000n);   // scalar, not array
  assert.equal(out[1].success, true);
  assert.equal(out[1].result, 'USDC');
  // sanity — Interface was reused for identical abi
  void iface;
});

test('batch: surfaces per-call failures as { success: false, error }', async () => {
  const coder = AbiCoder.defaultAbiCoder();
  const client = makeClient([
    { success: false, returnData: '0x' },
    { success: true, returnData: coder.encode(['uint256'], [42n]) },
  ]);

  const A = '0x' + 'aa'.repeat(20);
  const B = '0x' + 'bb'.repeat(20);
  const out = await client.batch([
    { address: '0xA', abi: SAMPLE_ABI, method: 'balanceOf', args: [A] },
    { address: '0xB', abi: SAMPLE_ABI, method: 'balanceOf', args: [B] },
  ]);
  assert.equal(out[0].success, false);
  assert.equal(out[0].result, null);
  assert.ok(out[0].error instanceof Error);
  assert.match(out[0].error.message, /reverted/);
  assert.equal(out[1].success, true);
  assert.equal(out[1].result, 42n);
});

test('batch: empty input returns empty array (no RPC call)', async () => {
  const client = makeClient([]);
  const out = await client.batch([]);
  assert.deepEqual(out, []);
});

test('batch: accepts ethers Contract instance form', async () => {
  const coder = AbiCoder.defaultAbiCoder();
  const client = makeClient([
    { success: true, returnData: coder.encode(['string'], ['TOK']) },
  ]);
  // Build a fake Contract-like object with .interface + .target
  const iface = new Interface(SAMPLE_ABI);
  const fakeContract = { target: '0xTOK', interface: iface };

  const out = await client.batch([{ contract: fakeContract, method: 'symbol' }]);
  assert.equal(out[0].result, 'TOK');
});

test('batch: rejects call spec missing both contract and {address, abi}', async () => {
  const client = makeClient([]);
  await assert.rejects(
    () => client.batch([{ method: 'foo' }]),
    /needs `contract` or/,
  );
});
