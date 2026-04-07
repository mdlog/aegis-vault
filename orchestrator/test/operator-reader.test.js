import test from 'node:test';
import assert from 'node:assert/strict';
import { checkOperatorEligibility } from '../src/services/operatorReader.js';

// checkOperatorEligibility accepts an explicit { strictMode } override so tests
// can verify both modes deterministically without re-importing the config singleton.

test('checkOperatorEligibility — non-strict, no operator state → eligible (legacy/dev)', () => {
  const result = checkOperatorEligibility({ nav: 1000 }, null, { strictMode: false });
  assert.equal(result.eligible, true);
});

test('checkOperatorEligibility — STRICT, no operator state → REJECTED', () => {
  const result = checkOperatorEligibility({ nav: 1000 }, null, { strictMode: true });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'OPERATOR_STACK_MISSING');
});

test('checkOperatorEligibility — STRICT, unregistered operator → REJECTED', () => {
  const result = checkOperatorEligibility({ nav: 1000 }, {
    registered: false,
    active: true,
    stake: { amountUsd: 50000, frozen: false, isUnlimited: false, maxVaultSizeUsd: 500000, tierLabel: 'Silver' },
  }, { strictMode: true });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'OPERATOR_NOT_REGISTERED');
});

test('checkOperatorEligibility — STRICT, zero stake → REJECTED', () => {
  const result = checkOperatorEligibility({ nav: 1000 }, {
    registered: true,
    active: true,
    stake: { amountUsd: 0, frozen: false, isUnlimited: false, maxVaultSizeUsd: 5000, tierLabel: 'None' },
  }, { strictMode: true });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'OPERATOR_NO_STAKE');
});

test('checkOperatorEligibility — frozen stake always rejected (any mode)', () => {
  const opState = {
    registered: true,
    active: true,
    stake: { amountUsd: 100000, frozen: true, isUnlimited: false, maxVaultSizeUsd: 500000, tierLabel: 'Silver' },
  };
  assert.equal(
    checkOperatorEligibility({ nav: 1000 }, opState, { strictMode: false }).reason,
    'OPERATOR_FROZEN'
  );
  assert.equal(
    checkOperatorEligibility({ nav: 1000 }, opState, { strictMode: true }).reason,
    'OPERATOR_FROZEN'
  );
});

test('checkOperatorEligibility — deactivated operator rejected', () => {
  const result = checkOperatorEligibility({ nav: 1000 }, {
    registered: true,
    active: false,
    stake: { amountUsd: 100000, frozen: false, isUnlimited: false, maxVaultSizeUsd: 500000, tierLabel: 'Silver' },
  }, { strictMode: false });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'OPERATOR_DEACTIVATED');
});

test('checkOperatorEligibility — TIER_CAP_EXCEEDED when vault NAV > max', () => {
  const result = checkOperatorEligibility({ nav: 600_000 }, {
    registered: true,
    active: true,
    stake: { amountUsd: 50000, frozen: false, isUnlimited: false, maxVaultSizeUsd: 500_000, tierLabel: 'Silver' },
  }, { strictMode: false });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'TIER_CAP_EXCEEDED');
});

test('checkOperatorEligibility — within cap → eligible', () => {
  const result = checkOperatorEligibility({ nav: 100_000 }, {
    registered: true,
    active: true,
    stake: { amountUsd: 50000, frozen: false, isUnlimited: false, maxVaultSizeUsd: 500_000, tierLabel: 'Silver' },
  }, { strictMode: false });
  assert.equal(result.eligible, true);
});

test('checkOperatorEligibility — Platinum (unlimited) bypasses tier cap', () => {
  const result = checkOperatorEligibility({ nav: 50_000_000 }, {
    registered: true,
    active: true,
    stake: { amountUsd: 1_500_000, frozen: false, isUnlimited: true, maxVaultSizeUsd: Infinity, tierLabel: 'Platinum' },
  }, { strictMode: false });
  assert.equal(result.eligible, true);
});

test('checkOperatorEligibility — STRICT + healthy operator within cap → eligible', () => {
  const result = checkOperatorEligibility({ nav: 100_000 }, {
    registered: true,
    active: true,
    stake: { amountUsd: 50_000, frozen: false, isUnlimited: false, maxVaultSizeUsd: 500_000, tierLabel: 'Silver' },
  }, { strictMode: true });
  assert.equal(result.eligible, true);
});
