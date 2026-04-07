import test from 'node:test';
import assert from 'node:assert/strict';
import { preCheckPolicy } from '../src/services/policyCheck.js';

// Build a baseline policy + vault state that pass every check.
function makePolicy(overrides = {}) {
  return {
    autoExecution: true,
    paused: false,
    confidenceThresholdBps: 5000,   // 50%
    maxPositionBps: 5000,            // 50%
    maxActionsPerDay: 20,
    cooldownSeconds: 0,
    maxDailyLossBps: 1000,           // 10%
    ...overrides,
  };
}

function makeVault(overrides = {}) {
  return {
    dailyActionsUsed: 0,
    lastExecutionTimestamp: 0,
    allowedAssets: [
      // Lowercase addresses for the canonical assets — getAssetAddress mirrors these
      // To keep the test isolated, we resolve via getAssetAddress at runtime via the helper.
    ],
    currentDailyLossPct: 0,
    ...overrides,
  };
}

function makeBuyDecision(overrides = {}) {
  return {
    action: 'buy',
    asset: 'BTC',
    confidence: 0.85,
    risk_score: 0.30,
    size_bps: 2000, // 20%
    ...overrides,
  };
}

// We need to pre-populate allowedAssets with the actual addresses the policy
// resolver will look up. Pull them lazily once the module is loaded.
async function loadAllowedAssetsForBTC() {
  const { getAssetAddress } = await import('../src/services/assets.js');
  return [
    getAssetAddress('BTC')?.toLowerCase(),
    getAssetAddress('USDC')?.toLowerCase(),
  ].filter(Boolean);
}

test('preCheckPolicy — valid buy decision passes all checks', async () => {
  const allowedAssets = await loadAllowedAssetsForBTC();
  const result = preCheckPolicy(
    makeBuyDecision(),
    makeVault({ allowedAssets }),
    makePolicy(),
  );
  assert.equal(result.valid, true);
});

test('preCheckPolicy — autoExecution disabled fails', async () => {
  const allowedAssets = await loadAllowedAssetsForBTC();
  const result = preCheckPolicy(
    makeBuyDecision(),
    makeVault({ allowedAssets }),
    makePolicy({ autoExecution: false }),
  );
  assert.equal(result.valid, false);
  assert.match(result.reason, /Auto-execution/);
});

test('preCheckPolicy — paused vault fails', async () => {
  const allowedAssets = await loadAllowedAssetsForBTC();
  const result = preCheckPolicy(
    makeBuyDecision(),
    makeVault({ allowedAssets }),
    makePolicy({ paused: true }),
  );
  assert.equal(result.valid, false);
  assert.match(result.reason, /paused/);
});

test('preCheckPolicy — low confidence fails', async () => {
  const allowedAssets = await loadAllowedAssetsForBTC();
  const result = preCheckPolicy(
    makeBuyDecision({ confidence: 0.3 }),
    makeVault({ allowedAssets }),
    makePolicy({ confidenceThresholdBps: 5000 }),
  );
  assert.equal(result.valid, false);
  assert.match(result.reason, /Confidence/);
});

test('preCheckPolicy — oversized buy fails', async () => {
  const allowedAssets = await loadAllowedAssetsForBTC();
  const result = preCheckPolicy(
    makeBuyDecision({ size_bps: 8000 }),  // 80%
    makeVault({ allowedAssets }),
    makePolicy({ maxPositionBps: 5000 }), // 50% cap
  );
  assert.equal(result.valid, false);
  assert.match(result.reason, /Position size/);
});

test('preCheckPolicy — daily action limit fails', async () => {
  const allowedAssets = await loadAllowedAssetsForBTC();
  const result = preCheckPolicy(
    makeBuyDecision(),
    makeVault({ allowedAssets, dailyActionsUsed: 20 }),
    makePolicy({ maxActionsPerDay: 20 }),
  );
  assert.equal(result.valid, false);
  assert.match(result.reason, /Daily action limit/);
});

test('preCheckPolicy — cooldown active fails', async () => {
  const allowedAssets = await loadAllowedAssetsForBTC();
  const now = Math.floor(Date.now() / 1000);
  const result = preCheckPolicy(
    makeBuyDecision(),
    makeVault({ allowedAssets, lastExecutionTimestamp: now - 100 }),
    makePolicy({ cooldownSeconds: 300 }),
  );
  assert.equal(result.valid, false);
  assert.match(result.reason, /Cooldown/);
});

test('preCheckPolicy — asset not whitelisted fails', async () => {
  // Vault only allows USDC (no BTC) → buy BTC should fail
  const { getAssetAddress } = await import('../src/services/assets.js');
  const result = preCheckPolicy(
    makeBuyDecision({ asset: 'BTC' }),
    makeVault({ allowedAssets: [getAssetAddress('USDC')?.toLowerCase()] }),
    makePolicy(),
  );
  assert.equal(result.valid, false);
  assert.match(result.reason, /not allowed/);
});

test('preCheckPolicy — daily loss exceeded fails', async () => {
  const allowedAssets = await loadAllowedAssetsForBTC();
  const result = preCheckPolicy(
    makeBuyDecision(),
    makeVault({ allowedAssets, currentDailyLossPct: 12 }),
    makePolicy({ maxDailyLossBps: 1000 }), // 10% cap
  );
  assert.equal(result.valid, false);
  assert.match(result.reason, /Daily loss/);
});

test('preCheckPolicy — risk score too high fails', async () => {
  const allowedAssets = await loadAllowedAssetsForBTC();
  const result = preCheckPolicy(
    makeBuyDecision({ risk_score: 0.92 }),
    makeVault({ allowedAssets }),
    makePolicy(),
  );
  assert.equal(result.valid, false);
  assert.match(result.reason, /Risk score/);
});

test('preCheckPolicy — hold action bypasses position size + asset checks', async () => {
  const result = preCheckPolicy(
    { action: 'hold', confidence: 0.9, risk_score: 0.2 },
    makeVault({ allowedAssets: [] }),
    makePolicy(),
  );
  assert.equal(result.valid, true);
});

test('preCheckPolicy — sell with valid fraction passes', async () => {
  const allowedAssets = await loadAllowedAssetsForBTC();
  const result = preCheckPolicy(
    makeBuyDecision({ action: 'sell', sell_fraction_bps: 5000 }),
    makeVault({ allowedAssets }),
    makePolicy(),
  );
  assert.equal(result.valid, true);
});

test('preCheckPolicy — sell with invalid fraction (0) fails', async () => {
  const allowedAssets = await loadAllowedAssetsForBTC();
  const result = preCheckPolicy(
    { action: 'sell', asset: 'BTC', confidence: 0.9, risk_score: 0.2, sell_fraction_bps: 0, size_bps: 0 },
    makeVault({ allowedAssets }),
    makePolicy(),
  );
  assert.equal(result.valid, false);
  assert.match(result.reason, /Sell fraction/);
});
