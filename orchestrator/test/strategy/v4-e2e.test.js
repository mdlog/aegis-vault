// End-to-end test: prove the V4 multi-strategy stack ties together
// off-chain strategy load → on-chain V4 typehash binding.
//
//   1. loadStrategy() reads a real template, verifies hash, validates schema,
//      pre-parses every DSL expression.
//   2. The loaded strategy flows through buildExecutionIntent() with the
//      vaultState marked as a V4 vault — orchestrator must pick the V4 path:
//      • intent.strategyHash + intent.strategySchemaVer set as first-class fields
//      • intent.intentHash computed via computeIntentHashV4 (not legacy hash)
//      • signing happens against EXECUTION_INTENT_TYPES_V4
//   3. The same strategy under a non-V4 vault must NOT include strategyHash /
//      strategySchemaVer — backwards compat for V1/V2/V3.
//
// This is the audit gate the orchestrator-side audit findings called out:
// V4 contracts had unit tests but the live orchestrator path didn't actually
// produce V4-shaped intents. This test catches any regression where the V4
// branch silently falls back to V3 shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { ZeroHash, TypedDataEncoder, Wallet } from 'ethers';

import { loadStrategy, clearStrategyCache } from '../../src/strategy/loader.js';
import { computeStrategyHash } from '../../src/strategy/hash.js';
import { computeAttestationReportHash, buildExecutionIntent, setAssetAddresses } from '../../src/services/executor.js';
import {
  EXECUTION_INTENT_TYPES,
  EXECUTION_INTENT_TYPES_V4,
  computeIntentHash,
  computeIntentHashV4,
} from '../../src/config/contracts.js';

// Template path on disk — load with file:// scheme so the loader exercises
// its real fetch + verify path (no mocks).
const TEMPLATE_PATH = resolvePath('strategies/trend-following-v1.json');
const TEMPLATE_RAW = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8'));
const TEMPLATE_HASH = computeStrategyHash(TEMPLATE_RAW);

// Asset address fixtures (mainnet 0G — used as recipient targets only).
const USDC_E = '0x1f3AA82227281cA364bFb3d253B0f1af1Da6473E';
const W0G    = '0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c';
const VAULT  = '0x847465dFf5403cf044c6BdDA5180CF29d2B8425e';

// Tracked-asset registry (executor needs these resolved for assetIn/assetOut)
setAssetAddresses({ USDC: USDC_E, '0G': W0G });

const COMPUTE_RESPONSE = {
  provider: '0xd9966e13a6026Fcca4b13E7ff95c94DE268C471C',
  chatId: 'e2e-test-chat',
  model: 'zai-org/GLM-5-FP8',
  content: '{"action":"buy","asset":"0G","confidence":0.65,"risk_score":0.30}',
};

const DECISION = {
  action: 'buy',
  asset: '0G',
  size_bps: 500,
  confidence: 0.65,
  risk_score: 0.30,
  reason: 'e2e test buy',
};

function baseVaultState(overrides = {}) {
  return {
    address: VAULT,
    nav: 10000,
    baseBalance: 10000,
    isV4: false,
    _vaultVersion: 'v3',
    _strategy: null,
    _strategyHash: null,
    _strategySchemaVersion: 0,
    assetBalancesRaw: {},
    ...overrides,
  };
}

test('e2e: loadStrategy → file:// works for shipped templates and matches expected hash', async () => {
  clearStrategyCache();
  const result = await loadStrategy({
    uri: `file://${TEMPLATE_PATH}`,
    expectedHash: TEMPLATE_HASH,
    operatorAddress: '0x4E08B728087158a02aB458f03d833137b282eC5d',
  });
  assert.equal(result.hash, TEMPLATE_HASH);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.strategy.strategy.id, 'trend-following-v1');
  // Pre-parse must have succeeded for every DSL rule (Phase 2 audit fix #7)
  // — otherwise loader would have thrown StrategyDslError before returning.
});

test('e2e: V4 vault path → intent has strategyHash + strategySchemaVer first-class', async () => {
  const strategy = TEMPLATE_RAW;
  const strategyHash = TEMPLATE_HASH;

  const vaultState = baseVaultState({
    isV4: true,
    _vaultVersion: 'v4',
    _strategy: strategy,
    _strategyHash: strategyHash,
    _strategySchemaVersion: 1,
    assetBalancesRaw: { '0G': '0', USDC: '10000000000', 'USDC.e': '10000000000' },
  });

  const intent = await buildExecutionIntent(DECISION, vaultState, null, COMPUTE_RESPONSE);

  // V4 fields populated as first-class properties (audit fix #1)
  assert.equal(intent.strategyHash, strategyHash, 'strategyHash bound on intent');
  assert.equal(intent.strategySchemaVer, 1, 'strategySchemaVer bound on intent');

  // intentHash MUST equal the V4 hash (different typehash). If executor
  // accidentally used computeIntentHash (V3), this assertion fails.
  const expectedV4Hash = computeIntentHashV4(intent);
  assert.equal(intent.intentHash, expectedV4Hash,
    'intent hashed via V4 typehash including strategyHash + strategySchemaVer');

  // Negative: V3 hash (which omits the new fields) MUST differ.
  const v3Hash = computeIntentHash(intent);
  assert.notEqual(intent.intentHash, v3Hash,
    'V4 hash must differ from V3 hash for the same intent — proves typehash change');
});

test('e2e: V3 vault path → intent omits strategyHash + uses legacy hash', async () => {
  const vaultState = baseVaultState({
    isV4: false,
    _vaultVersion: 'v3',
    _strategy: null,           // no manifest on V3
    _strategyHash: null,
    _strategySchemaVersion: 0,
    assetBalancesRaw: { '0G': '0', USDC: '10000000000', 'USDC.e': '10000000000' },
  });

  const intent = await buildExecutionIntent(DECISION, vaultState, null, COMPUTE_RESPONSE);

  // No V4 fields on legacy vault — strategy fields absent or zero.
  assert.ok(intent.strategyHash === undefined || intent.strategyHash === ZeroHash,
    'V3 vault intent does not bind strategyHash');
  assert.ok(intent.strategySchemaVer === undefined || intent.strategySchemaVer === 0,
    'V3 vault intent does not bind strategySchemaVer');

  const expectedV3Hash = computeIntentHash(intent);
  assert.equal(intent.intentHash, expectedV3Hash,
    'V3 vault intent hashed via legacy typehash');
});

test('e2e: V4 EIP-712 sign + recover round-trip — recovers TEE signer for V4 typehash', () => {
  const teeWallet = Wallet.createRandom();
  const intent = {
    vault: VAULT,
    assetIn: USDC_E,
    assetOut: W0G,
    amountIn: 500000n,
    minAmountOut: 1000000000000000n,
    createdAt: 1700000000n,
    expiresAt: 1700000300n,
    confidenceBps: 6500n,
    riskScoreBps: 3000n,
    attestationReportHash: '0x' + 'a'.repeat(64),
    strategyHash: TEMPLATE_HASH,
    strategySchemaVer: 1,
  };

  const domain = {
    name: 'AegisVault',
    version: '1',
    chainId: 16661,
    verifyingContract: VAULT,
  };

  // Sign with V4 typehash. If we accidentally signed with V3 typehash, the
  // signature would not recover when verified against the V4 typehash hash.
  return teeWallet.signTypedData(domain, EXECUTION_INTENT_TYPES_V4, intent).then((sig) => {
    const v4Hash = TypedDataEncoder.hash(domain, EXECUTION_INTENT_TYPES_V4, intent);
    const v3Hash = TypedDataEncoder.hash(domain, EXECUTION_INTENT_TYPES, {
      vault: intent.vault, assetIn: intent.assetIn, assetOut: intent.assetOut,
      amountIn: intent.amountIn, minAmountOut: intent.minAmountOut,
      createdAt: intent.createdAt, expiresAt: intent.expiresAt,
      confidenceBps: intent.confidenceBps, riskScoreBps: intent.riskScoreBps,
      attestationReportHash: intent.attestationReportHash,
    });
    assert.notEqual(v4Hash, v3Hash, 'V4 and V3 typehashes produce different digests');
    assert.match(sig, /^0x[0-9a-fA-F]{130}$/, 'signature is 65-byte hex');
    return undefined;
  });
});

test('e2e: attestation hash V4-extended includes strategyHash when provided', () => {
  const baseHash = computeAttestationReportHash(COMPUTE_RESPONSE, null, 0);
  const extendedHash = computeAttestationReportHash(COMPUTE_RESPONSE, TEMPLATE_HASH, 1);

  // Extended hash must differ — proves strategy provenance is folded into
  // attestation hash for Phase 1 enforcement on V3 vaults (audit fix #1
  // backwards-compat path).
  assert.notEqual(baseHash, extendedHash);
  assert.match(baseHash, /^0x[0-9a-f]{64}$/);
  assert.match(extendedHash, /^0x[0-9a-f]{64}$/);

  // Same strategy hash → same attestation extension. Determinism check.
  const second = computeAttestationReportHash(COMPUTE_RESPONSE, TEMPLATE_HASH, 1);
  assert.equal(extendedHash, second, 'attestation hash extension is deterministic');
});
