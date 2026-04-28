// V4 strategy-binding error decoding regression test.
//
// The audit flagged that the executor's catch-block error decoder only
// covered V3 custom errors. After the V4 cutover, a vault that rejects an
// intent with `WrongStrategyHash` or `UnsupportedSchemaVersion` would
// surface as a raw 4-byte selector in ops logs. This test pins the
// decoded names so a future refactor cannot silently drop them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';

import { decodeIntentSubmitError } from '../src/services/executor.js';

// Encode a custom error by name to mirror what the RPC layer hands back.
function encodeCustomError(signature, args = []) {
  const iface = new ethers.Interface([`error ${signature}`]);
  const fragment = iface.fragments[0];
  return iface.encodeErrorResult(fragment, args);
}

test('decoder names WrongStrategyHash (V4)', () => {
  const err = { data: encodeCustomError('WrongStrategyHash()'), message: '0xa1b2c3d4...' };
  assert.equal(decodeIntentSubmitError(err), 'WrongStrategyHash');
});

test('decoder names UnsupportedSchemaVersion (V4)', () => {
  const err = { data: encodeCustomError('UnsupportedSchemaVersion()'), message: '0xa1b2c3d4...' };
  assert.equal(decodeIntentSubmitError(err), 'UnsupportedSchemaVersion');
});

test('decoder still names V3 errors (regression guard)', () => {
  for (const sig of [
    'IntentHashMismatch()',
    'IntentVaultMismatch()',
    'AutoExecutionDisabled()',
    'SwapOutputMismatch()',
    'OnlyExecutor()',
    'VaultPaused()',
  ]) {
    const err = { data: encodeCustomError(sig), message: 'raw' };
    const expected = sig.replace('()', '');
    assert.equal(decodeIntentSubmitError(err), expected, `expected ${expected}`);
  }
});

test('decoder includes args for parametric error PolicyCheckFailed', () => {
  const err = {
    data: encodeCustomError('PolicyCheckFailed(string)', ['confidence below threshold']),
    message: 'raw',
  };
  assert.equal(
    decodeIntentSubmitError(err),
    'PolicyCheckFailed: confidence below threshold',
  );
});

test('decoder falls back to err.message for unknown selector', () => {
  const err = { data: '0xdeadbeef', message: 'unknown revert' };
  assert.equal(decodeIntentSubmitError(err), 'unknown revert');
});

test('decoder falls back to err.message when err.data is missing', () => {
  const err = { message: 'execution reverted' };
  assert.equal(decodeIntentSubmitError(err), 'execution reverted');
});
