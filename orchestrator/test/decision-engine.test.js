import test from 'node:test';
import assert from 'node:assert/strict';
import { toSimpleDecision } from '../src/services/decisionEngine.js';

// Note: runDecisionEngine pulls in indicators + regime classifier with heavy
// dependencies. We test the leaf converter that the executor actually consumes,
// since it's pure and translates the v1 schema → executor schema.

test('toSimpleDecision — buy action with asset rotation USDC → BTC', () => {
  const result = toSimpleDecision({
    simple_action: 'buy',
    action: 'BUY',
    recommended_asset_in: 'USDC',
    recommended_asset_out: 'BTC',
    size_bps: 2500,
    confidence: 0.78,
    risk_score: 0.32,
    reason_summary: 'momentum entry',
    source: 'engine-v1',
    regime: 'UP_STRONG',
    final_edge_score: 78,
    trade_quality_score: 82,
    hard_veto: false,
    hard_veto_reasons: [],
    entry_trigger: 'ema_cross',
  });

  assert.equal(result.action, 'buy');
  assert.equal(result.asset, 'BTC');
  assert.equal(result.size_bps, 2500);
  assert.equal(result.sell_fraction_bps, 0);
  assert.equal(result.confidence, 0.78);
  assert.equal(result.regime, 'UP_STRONG');
  assert.equal(result.v1_action, 'BUY');
});

test('toSimpleDecision — sell action picks reduce_fraction over size when present', () => {
  const result = toSimpleDecision({
    simple_action: 'sell',
    action: 'REDUCE',
    recommended_asset_in: 'BTC',
    recommended_asset_out: 'USDC',
    size_bps: 5000,
    reduce_fraction_bps: 3000, // explicit reduce fraction wins
    confidence: 0.6,
    risk_score: 0.4,
  });

  assert.equal(result.action, 'sell');
  assert.equal(result.sell_fraction_bps, 3000);
});

test('toSimpleDecision — sell falls back to size_bps when no reduce_fraction', () => {
  const result = toSimpleDecision({
    simple_action: 'sell',
    action: 'SELL',
    recommended_asset_in: 'BTC',
    recommended_asset_out: 'USDC',
    size_bps: 4000,
    confidence: 0.55,
    risk_score: 0.45,
  });

  assert.equal(result.sell_fraction_bps, 4000);
});

test('toSimpleDecision — sell defaults to 100% when neither field set', () => {
  const result = toSimpleDecision({
    simple_action: 'sell',
    action: 'SELL_ALL',
    recommended_asset_in: 'BTC',
    recommended_asset_out: 'USDC',
    confidence: 0.9,
    risk_score: 0.2,
  });

  assert.equal(result.sell_fraction_bps, 10000);
});

test('toSimpleDecision — asset selection picks the non-USDC side', () => {
  // USDC → BTC: asset = BTC
  const buy = toSimpleDecision({
    simple_action: 'buy',
    recommended_asset_in: 'USDC',
    recommended_asset_out: 'BTC',
  });
  assert.equal(buy.asset, 'BTC');

  // BTC → USDC: asset = BTC (sell side)
  const sell = toSimpleDecision({
    simple_action: 'sell',
    recommended_asset_in: 'BTC',
    recommended_asset_out: 'USDC',
  });
  assert.equal(sell.asset, 'BTC');
});

test('toSimpleDecision — preserves all v1 metadata for journaling', () => {
  const v1 = {
    simple_action: 'hold',
    action: 'HOLD',
    confidence: 0.4,
    risk_score: 0.5,
    reason_summary: 'awaiting confirmation',
    source: 'engine-v1',
    regime: 'CHOP',
    final_edge_score: 45,
    trade_quality_score: 38,
    hard_veto: true,
    hard_veto_reasons: ['low_confidence', 'wide_spread'],
    entry_trigger: null,
  };
  const out = toSimpleDecision(v1);
  assert.equal(out.regime, 'CHOP');
  assert.equal(out.final_edge_score, 45);
  assert.deepEqual(out.hard_veto_reasons, ['low_confidence', 'wide_spread']);
  assert.equal(out.hard_veto, true);
});
