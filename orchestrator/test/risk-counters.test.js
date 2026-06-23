import test from 'node:test';
import assert from 'node:assert/strict';
import { nextConsecutiveLosses } from '../src/services/orchestrator.js';

// Regression — ORCHESTRATOR_REVIEW.md M1.
//
// consecutive_losses fed riskVeto (#consecutive_losses_exceeded), the decisionEngine
// BUY gate (losses_ok), and signal scoring — but the counter was only ever reset to 0
// and never incremented, so the loss-streak circuit breaker was permanently inert.
// nextConsecutiveLosses derives the next value from a settled trade's realized PnL.

test('a losing SELL increments the streak', () => {
  assert.equal(nextConsecutiveLosses(2, { action: 'sell', pnlUsd6: -5_000000n, costBasisKnown: true }), 3);
});

test('a winning or break-even SELL resets the streak', () => {
  assert.equal(nextConsecutiveLosses(3, { action: 'sell', pnlUsd6: 10_000000n, costBasisKnown: true }), 0);
  assert.equal(nextConsecutiveLosses(3, { action: 'sell', pnlUsd6: 0n, costBasisKnown: true }), 0);
});

test('a BUY resets the streak (opening fresh risk)', () => {
  assert.equal(nextConsecutiveLosses(4, { action: 'buy', pnlUsd6: 0n, costBasisKnown: false }), 0);
});

test('a SELL with unknown cost basis leaves the streak unchanged (no phantom loss)', () => {
  assert.equal(nextConsecutiveLosses(2, { action: 'sell', pnlUsd6: 0n, costBasisKnown: false }), 2);
});

test('hold / unknown action leaves the streak unchanged', () => {
  assert.equal(nextConsecutiveLosses(1, { action: 'hold', pnlUsd6: 0n, costBasisKnown: false }), 1);
});

test('null/undefined current is treated as 0', () => {
  assert.equal(nextConsecutiveLosses(undefined, { action: 'sell', pnlUsd6: -1n, costBasisKnown: true }), 1);
});
