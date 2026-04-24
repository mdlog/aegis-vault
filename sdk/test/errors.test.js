// Tests for parseContractError — verifies wallet rejections, standard ERC-20
// errors, protocol custom errors, and the fallback path.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseContractError, parseTxError, isUserRejection } from '../src/errors.js';

test('parseContractError: returns null for falsy input', () => {
  assert.equal(parseContractError(null), null);
  assert.equal(parseContractError(undefined), null);
});

test('parseContractError: detects ethers v6 ACTION_REJECTED', () => {
  const err = { code: 'ACTION_REJECTED', shortMessage: 'user rejected action' };
  const parsed = parseContractError(err);
  assert.equal(parsed.isUserReject, true);
  assert.equal(parsed.code, 4001);
  assert.match(parsed.message, /You rejected/);
});

test('parseContractError: detects EIP-1193 code 4001', () => {
  assert.equal(isUserRejection({ code: 4001 }), true);
  assert.equal(isUserRejection({ cause: { code: 4001 } }), true);
  assert.equal(isUserRejection({ message: 'User denied transaction signature.' }), true);
});

test('parseContractError: maps ERC20InsufficientAllowance', () => {
  const err = { message: 'execution reverted: ERC20InsufficientAllowance(0x..)' };
  const parsed = parseContractError(err);
  assert.equal(parsed.isUserReject, false);
  assert.match(parsed.title, /approval is too small/i);
});

test('parseContractError: maps ERC20InsufficientBalance', () => {
  const err = { reason: 'ERC20InsufficientBalance' };
  const parsed = parseContractError(err);
  assert.match(parsed.title, /Insufficient token balance/i);
});

test('parseContractError: maps TierCapExceeded (protocol custom error)', () => {
  const err = { shortMessage: 'execution reverted: TierCapExceeded()' };
  const parsed = parseContractError(err);
  assert.match(parsed.title, /tier cap exceeded/i);
});

test('parseContractError: maps IntentAlreadyFinalized', () => {
  const parsed = parseContractError({ reason: 'IntentAlreadyFinalized' });
  assert.match(parsed.title, /already finalized/i);
});

test('parseContractError: maps NotAuthorizedVault', () => {
  const parsed = parseContractError({ message: 'NotAuthorizedVault()' });
  assert.match(parsed.title, /not authorized/i);
});

test('parseContractError: gas / nonce / network failures', () => {
  assert.match(
    parseContractError({ message: 'insufficient funds for gas * price + value' }).title,
    /not enough gas/i,
  );
  assert.match(
    parseContractError({ message: 'nonce too low' }).title,
    /stale transaction/i,
  );
  assert.match(
    parseContractError({ message: 'request timed out' }).title,
    /timeout/i,
  );
});

test('parseContractError: fallback path preserves first line, strips noise', () => {
  const err = {
    message: 'something weird happened\nwith a stack trace\nand JSON payload',
  };
  const parsed = parseContractError(err);
  assert.equal(parsed.title, 'Transaction failed');
  assert.match(parsed.message, /something weird happened/);
  assert.doesNotMatch(parsed.message, /stack trace/);
});

test('parseContractError: walks nested ethers v6 shape (info.error, cause)', () => {
  const err = {
    message: 'call revert exception',
    info: { error: { message: 'OperatorFrozen()' } },
  };
  const parsed = parseContractError(err);
  assert.match(parsed.title, /frozen/i);
});

test('parseTxError is an alias for parseContractError', () => {
  assert.strictEqual(parseTxError, parseContractError);
});
