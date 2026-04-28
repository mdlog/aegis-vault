// V4 orchestrator gate-logic regression tests.
//
// Two pure-function gates inside orchestrator.runVaultCycle deserve their
// own coverage because the audit identified each as a regression risk:
//
//   1. shouldUseKhalaniRoute(intent, vaultState)
//      — returns true when the orchestrator should dispatch a Khalani
//        cross-chain order instead of submitting an on-chain Jaine intent.
//        Pre-V4 the gate was `vaultState.isV3` only; the audit found that
//        V4 vaults were silently locked out of Khalani even though their
//        `acceptCrossChainFill` works identically.
//
//   2. isStrategyHashMismatch(vaultState, loadedStrategyHash)
//      — returns true when the strategy the orchestrator just loaded for
//        this vault's operator does not match what the V4 vault has
//        committed to accept. A `true` here makes the orchestrator skip
//        the cycle to avoid burning gas on a guaranteed `WrongStrategyHash`
//        revert.
//
// Both helpers are pure, so the tests are full unit-tests with no mocks.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ZeroHash } from 'ethers';

import {
  shouldUseKhalaniRoute,
  isStrategyHashMismatch,
} from '../src/services/orchestrator.js';

const HASH_A = '0x' + 'a'.repeat(64);
const HASH_B = '0x' + 'b'.repeat(64);

// ── shouldUseKhalaniRoute ──────────────────────────────────────────────

test('Khalani gate: V3 vault + khalani route → true', () => {
  const intent = { routeChoice: { route: 'khalani' } };
  const vaultState = { isV3: true, isV4: false };
  assert.equal(shouldUseKhalaniRoute(intent, vaultState), true);
});

test('Khalani gate: V4 vault + khalani route → true (audit fix)', () => {
  // The audit caught a regression where V4 vaults were locked out of the
  // cross-chain path even though they support `acceptCrossChainFill`.
  const intent = { routeChoice: { route: 'khalani' } };
  const vaultState = { isV3: false, isV4: true };
  assert.equal(shouldUseKhalaniRoute(intent, vaultState), true);
});

test('Khalani gate: V1/V2 vault + khalani route → false (no acceptCrossChainFill)', () => {
  const intent = { routeChoice: { route: 'khalani' } };
  const vaultState = { isV3: false, isV4: false };
  assert.equal(shouldUseKhalaniRoute(intent, vaultState), false);
});

test('Khalani gate: V3 vault + jaine route → false (route is jaine)', () => {
  const intent = { routeChoice: { route: 'jaine' } };
  const vaultState = { isV3: true, isV4: false };
  assert.equal(shouldUseKhalaniRoute(intent, vaultState), false);
});

test('Khalani gate: missing routeChoice → false', () => {
  const vaultState = { isV3: true, isV4: false };
  assert.equal(shouldUseKhalaniRoute({}, vaultState), false);
  assert.equal(shouldUseKhalaniRoute({ routeChoice: null }, vaultState), false);
});

test('Khalani gate: missing vaultState → false (no version flags)', () => {
  const intent = { routeChoice: { route: 'khalani' } };
  assert.equal(shouldUseKhalaniRoute(intent, undefined), false);
  assert.equal(shouldUseKhalaniRoute(intent, {}), false);
});

// ── isStrategyHashMismatch ─────────────────────────────────────────────

test('Mismatch gate: V4 vault + matching hash → false', () => {
  const vaultState = { isV4: true, acceptedManifestHash: HASH_A };
  assert.equal(isStrategyHashMismatch(vaultState, HASH_A), false);
});

test('Mismatch gate: V4 vault + matching hash (case-insensitive) → false', () => {
  const vaultState = { isV4: true, acceptedManifestHash: HASH_A.toUpperCase() };
  assert.equal(isStrategyHashMismatch(vaultState, HASH_A.toLowerCase()), false);
});

test('Mismatch gate: V4 vault + different hash → true (would revert WrongStrategyHash)', () => {
  const vaultState = { isV4: true, acceptedManifestHash: HASH_A };
  assert.equal(isStrategyHashMismatch(vaultState, HASH_B), true);
});

test('Mismatch gate: V4 vault accepting zero hash → false (backwards-compat valve)', () => {
  // A vault initialised with `acceptedManifestHash == 0` only accepts intents
  // whose strategyHash is also zero — that matches the orchestrator default
  // when no manifest is loaded, so the gate must let it through.
  const vaultState = { isV4: true, acceptedManifestHash: ZeroHash };
  assert.equal(isStrategyHashMismatch(vaultState, HASH_A), false);
  assert.equal(isStrategyHashMismatch(vaultState, ZeroHash), false);
});

test('Mismatch gate: V3 vault → false regardless of hash (no slot to mismatch)', () => {
  // V3 vaults have no acceptedManifestHash slot. The gate must not fire on
  // them — V4-only behaviour.
  const vaultState = { isV3: true, isV4: false, acceptedManifestHash: HASH_A };
  assert.equal(isStrategyHashMismatch(vaultState, HASH_B), false);
});

test('Mismatch gate: missing fields → false (no false positives)', () => {
  assert.equal(isStrategyHashMismatch(null, HASH_A), false);
  assert.equal(isStrategyHashMismatch({ isV4: true }, HASH_A), false);
  assert.equal(isStrategyHashMismatch({ isV4: true, acceptedManifestHash: HASH_A }, null), false);
});
