// Tests for the operator write path — buildOperatorInput normalisation,
// Mandate enum stability, and the createOperator orchestration flow.
// We stub OperatorClient's contracts with fakes so these run without a node.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Mandate,
  MandateLabel,
  buildOperatorInput,
  OperatorClient,
} from '../src/operator.js';

test('Mandate enum values match the on-chain solidity order', () => {
  assert.equal(Mandate.Conservative, 0);
  assert.equal(Mandate.Balanced, 1);
  assert.equal(Mandate.Tactical, 2);
  assert.equal(MandateLabel[0], 'Conservative');
  assert.equal(MandateLabel[1], 'Balanced');
  assert.equal(MandateLabel[2], 'Tactical');
});

test('buildOperatorInput: pct inputs round to bps, minutes to seconds', () => {
  const out = buildOperatorInput({
    name: 'Aegis Alpha',
    description: 'Balanced mandate v1',
    endpoint: 'https://op.aegis.xyz',
    mandate: Mandate.Balanced,
    performanceFeePct: 15,         // → 1500 bps
    managementFeePct: 2,           // → 200 bps
    entryFeePct: 0,
    exitFeePct: 0,
    recommendedMaxPositionPct: 50, // → 5000 bps
    recommendedConfidenceMinPct: 60,
    recommendedStopLossPct: 15,
    recommendedCooldownMinutes: 15,
    recommendedMaxActionsPerDay: 6,
  });
  assert.equal(out.performanceFeeBps, 1500);
  assert.equal(out.managementFeeBps, 200);
  assert.equal(out.recommendedMaxPositionBps, 5000);
  assert.equal(out.recommendedCooldownSeconds, 900);
  assert.equal(out.mandate, 1);
});

test('buildOperatorInput: bps inputs are taken as-is', () => {
  const out = buildOperatorInput({
    name: 'x', description: 'y', endpoint: 'z',
    mandate: 0,
    performanceFeeBps: 1000, managementFeeBps: 100,
    entryFeeBps: 0, exitFeeBps: 0,
    recommendedMaxPositionBps: 4000,
    recommendedConfidenceMinBps: 6500,
    recommendedStopLossBps: 1200,
    recommendedCooldownSeconds: 600,
    recommendedMaxActionsPerDay: 4,
  });
  assert.equal(out.performanceFeeBps, 1000);
  assert.equal(out.recommendedCooldownSeconds, 600);
});

test('buildOperatorInput: rejects missing fields and bad mandate', () => {
  assert.throws(() => buildOperatorInput(null), /input object required/);
  assert.throws(
    () => buildOperatorInput({ description: 'x', endpoint: 'y', mandate: 0 }),
    /name, description, endpoint required/,
  );
  assert.throws(
    () => buildOperatorInput({
      name: 'a', description: 'b', endpoint: 'c', mandate: 9,
      performanceFeeBps: 0, managementFeeBps: 0, entryFeeBps: 0, exitFeeBps: 0,
      recommendedMaxPositionBps: 0, recommendedConfidenceMinBps: 0,
      recommendedStopLossBps: 0, recommendedCooldownSeconds: 0,
      recommendedMaxActionsPerDay: 0,
    }),
    /mandate must be/,
  );
});

// ── createOperator flow ─────────────────────────────────────────────

/** Build a fake OperatorClient whose contracts are stubs we can inspect. */
function makeFakeClient({ alreadyRegistered = false, alreadyActive = false, allowance = 0n } = {}) {
  const calls = [];
  const fakeTx = (name) => ({
    hash: `0x${name}hash`,
    wait: async () => ({ status: 1 }),
  });
  const fakeReceipt = (name) => (...args) => {
    calls.push({ name, args });
    return Promise.resolve(fakeTx(name));
  };

  const registry = {
    target: '0xREGISTRY',
    isRegistered: async () => alreadyRegistered,
    isActive: async () => alreadyActive,
    register:        fakeReceipt('register'),
    updateMetadata:  fakeReceipt('updateMetadata'),
    declareAIModel:  fakeReceipt('declareAIModel'),
    publishManifest: fakeReceipt('publishManifest'),
    activate:        fakeReceipt('activate'),
    deactivate:      fakeReceipt('deactivate'),
  };
  const staking = {
    target: '0xSTAKING',
    stakeToken: async () => '0xSTAKETOKEN',
    stake:           fakeReceipt('stake'),
    requestUnstake:  fakeReceipt('requestUnstake'),
    claimUnstake:    fakeReceipt('claimUnstake'),
  };
  const reputation = { target: '0xREP' };

  // Build client without invoking ctor (which would call ethers Contract()).
  const client = Object.create(OperatorClient.prototype);
  client.address = '0xOPERATOR';
  client.runner = {
    getAddress: async () => '0xOPERATOR',
  };
  client.registry = registry;
  client.staking = staking;
  client.reputation = reputation;

  // Patch approveStake to avoid constructing a real ethers Contract for the token.
  client.approveStake = async (amount) => {
    if (BigInt(allowance) >= BigInt(amount)) return null;
    calls.push({ name: 'approveStake', args: [amount] });
    return fakeTx('approveStake');
  };

  return { client, calls };
}

const baseInput = buildOperatorInput({
  name: 'Test Op', description: 'desc', endpoint: 'https://e',
  mandate: Mandate.Balanced,
  performanceFeePct: 15, managementFeePct: 2, entryFeePct: 0, exitFeePct: 0,
  recommendedMaxPositionPct: 50, recommendedConfidenceMinPct: 60,
  recommendedStopLossPct: 15, recommendedCooldownMinutes: 15,
  recommendedMaxActionsPerDay: 6,
});

test('createOperator: minimal path (register + activate)', async () => {
  const { client, calls } = makeFakeClient();
  const steps = [];
  const out = await client.createOperator({
    input: baseInput,
    onStep: (name, tx) => { if (tx) steps.push(name); },
  });
  assert.deepEqual(calls.map((c) => c.name), ['register', 'activate']);
  assert.deepEqual(steps, ['register', 'activate']);
  assert.equal(out.alreadyRegistered, false);
  assert.equal(out.txHashes.register, '0xregisterhash');
  assert.equal(out.txHashes.activate, '0xactivatehash');
  assert.equal(out.txHashes.stake, null);
});

test('createOperator: skips register when already registered, skips activate when active', async () => {
  const { client, calls } = makeFakeClient({ alreadyRegistered: true, alreadyActive: true });
  const out = await client.createOperator({ input: baseInput });
  assert.deepEqual(calls.map((c) => c.name), []); // nothing to do
  assert.equal(out.alreadyRegistered, true);
  assert.equal(out.txHashes.register, null);
  assert.equal(out.txHashes.activate, null);
});

test('createOperator: full flow with AI + manifest + stake', async () => {
  const { client, calls } = makeFakeClient();
  const out = await client.createOperator({
    input: baseInput,
    ai: { model: 'zai-org/GLM-5-FP8', provider: '0xAI', endpoint: 'https://ai' },
    manifest: { uri: 'ipfs://x', hash: '0x' + 'ab'.repeat(32), bonded: true },
    stakeAmount: 100_000_000n,
  });
  assert.deepEqual(
    calls.map((c) => c.name),
    ['register', 'declareAIModel', 'publishManifest', 'approveStake', 'stake', 'activate'],
  );
  assert.equal(out.txHashes.declareAIModel, '0xdeclareAIModelhash');
  assert.equal(out.txHashes.stake, '0xstakehash');
});

test('createOperator: autoActivate=false skips the activate step', async () => {
  const { client, calls } = makeFakeClient();
  const out = await client.createOperator({ input: baseInput, autoActivate: false });
  assert.deepEqual(calls.map((c) => c.name), ['register']);
  assert.equal(out.txHashes.activate, null);
});

test('createOperator: skips approve when existing allowance already covers stake', async () => {
  const { client, calls } = makeFakeClient({ allowance: 999_999_999n });
  await client.createOperator({
    input: baseInput,
    stakeAmount: 100n,
  });
  // approveStake should NOT appear (returns null when allowance sufficient)
  assert.ok(!calls.find((c) => c.name === 'approveStake'),
    'approveStake must be skipped when allowance already covers amount');
  assert.ok(calls.find((c) => c.name === 'stake'));
});
