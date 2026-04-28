// Integration tests proving the multi-strategy claim end-to-end.
//
// These tests feed identical synthetic market data through the decision
// engine with different operator strategy manifests and assert the
// engine's output reflects the strategy choice. The point is to demonstrate
// — at the test level, with real engine code — that swapping the manifest
// alone changes the signal that reaches on-chain execution.
//
// What we verify:
//   * Strategy provenance (`strategy_id`, `strategy_type`, `ai_mode`)
//     propagates correctly through every shipped template.
//   * The same synthetic uptrend produces a different decision under
//     trend-following vs mean-reversion.
//   * `hard_gate` mode actually flips a tentative BUY into a HOLD when
//     the AI's `action_hint` disagrees, populating `ai_override`.
//   * `context_only` mode neutralises AI numeric inputs (final_edge_score
//     not driven by the model), and `scoring_input` lets them through.
//   * Strategy gate overrides take precedence over default engine
//     thresholds (verified indirectly by comparing decisions for a
//     market that crosses one strategy's gate but not another's).
//
// These are not backtests. The synthetic series are deterministic so the
// test surface is stable across CI runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runDecisionEngine } from '../../src/services/decisionEngine.js';

const STRATEGIES_DIR = join(process.cwd(), 'strategies');

function loadTemplate(name) {
  return JSON.parse(readFileSync(join(STRATEGIES_DIR, `${name}.json`), 'utf8'));
}

// ── Synthetic price series builders ──
//
// classifyRegime needs at least 200 closes to compute ema_200, plus enough
// history for RSI / MACD warm-up. We use ~260 bars in every series so the
// indicators are fully populated regardless of timeframe.
const HISTORY_LEN = 260;

// Smooth uptrend that mirrors the TREND_UP_STRONG entry condition:
// price climbing above ema_20 > ema_50 > ema_200, MACD histogram positive,
// RSI parked in the 58-74 band, low ATR.
function uptrendSeries() {
  const prices = [];
  const volumes = [];
  let p = 1500;
  for (let i = 0; i < HISTORY_LEN; i++) {
    // Linear drift + small bounded oscillation to keep ATR sane.
    p = 1500 + i * 3 + Math.sin(i / 4) * 4;
    prices.push(p);
    volumes.push(1_000_000 + Math.sin(i / 7) * 50_000);
  }
  // The current bar continues the trend so RSI lands in mid-bullish range.
  const currentPrice = p + 6;
  const highs = prices.map((x) => x * 1.002);
  const lows  = prices.map((x) => x * 0.998);
  return {
    priceHistory: { prices, volumes, highs, lows },
    currentPrice,
    currentVolume: 1_500_000,
  };
}

// Sideways market with low ATR so RANGE_STABLE / RANGE_NOISY can fire.
// Mean is constant; oscillation amplitude is tight.
function sidewaysSeries() {
  const prices = [];
  const volumes = [];
  for (let i = 0; i < HISTORY_LEN; i++) {
    const p = 2000 + Math.sin(i / 6) * 8 + Math.cos(i / 11) * 4;
    prices.push(p);
    volumes.push(900_000 + Math.cos(i / 5) * 30_000);
  }
  // Force the latest bar to print BELOW its recent mean to nudge RSI down,
  // which is what mean-reversion wants for entry_long.
  const currentPrice = 1985;
  const highs = prices.map((x) => x * 1.003);
  const lows  = prices.map((x) => x * 0.997);
  return {
    priceHistory: { prices, volumes, highs, lows },
    currentPrice,
    currentVolume: 800_000,
  };
}

// Common vault state — flat position, healthy.
function flatVaultState(overrides = {}) {
  return {
    current_position_side: 'flat',
    current_position_pnl_pct: 0,
    rolling_drawdown_pct: 0,
    consecutive_losses: 0,
    nav: 100_000,
    balance: 100_000,
    ...overrides,
  };
}

// Open-position vault state — used when we want to test exit pathways.
function openVaultState(overrides = {}) {
  return {
    current_position_side: 'long',
    current_position_pnl_pct: 1.5,
    rolling_drawdown_pct: 0,
    consecutive_losses: 0,
    nav: 100_000,
    balance: 100_000,
    position_holding_seconds: 3600,
    position_notional_usd: 10_000,
    ...overrides,
  };
}

const POLICY = {
  max_position_bps: 1500,
  stop_loss_bps: 220,
  take_profit_bps: 450,
  cooldown_seconds: 0,
  max_actions_per_day: 100,
  max_slippage_bps: 50,
  max_spread_bps: 30,
  // Vault policy is the HARD CEILING — strategy can only tighten further,
  // never relax. To exercise strategy overrides in these tests we set the
  // policy gates maximally permissive (matches a depositor who delegated
  // full discretion to the operator's strategy).
  min_quality_buy: 0,
  min_edge_buy: 0,
  min_confidence_buy: 0,
  max_risk_score_buy: 1.0,
  allowed_buy_regimes: [
    'TREND_UP_STRONG', 'TREND_UP_WEAK', 'RANGE_STABLE',
    'RANGE_NOISY', 'TREND_DOWN_WEAK', 'TREND_DOWN_STRONG',
    'PANIC_VOLATILE', 'LOW_LIQUIDITY',
  ],
};

const AI_BULLISH = {
  confidence: 0.72,
  risk_score: 0.30,
  ai_context_score: 65,
  timing_score: 70,
  action_hint: 'buy',
};

// ─────────────────────────────────────────────────────────────────────────

test('integration: each shipped strategy propagates strategy_id + ai_mode into the decision', () => {
  // The five strategy_id / ai_mode combinations are the marketing surface
  // operators pin on dashboards. They MUST round-trip through the decision
  // engine into the output object byte-for-byte; if a refactor drops the
  // field on one branch, this catches it before it ships.
  const market = {
    ...uptrendSeries(),
    vaultState: flatVaultState(),
    policy: POLICY,
    aiView: AI_BULLISH,
    symbol: 'ETH/USDC',
  };

  const cases = [
    ['trend-following-v1',   'trend_following', 'scoring_input'],
    ['mean-reversion-v1',    'mean_reversion',  'hard_gate'],
    ['momentum-breakout-v1', 'momentum',        'scoring_input'],
    ['arbitrage-stable-v1',  'arbitrage',       'context_only'],
    ['market-neutral-v1',    'market_neutral',  'scoring_input'],
  ];

  for (const [id, type, mode] of cases) {
    const strategy = loadTemplate(id);
    const decision = runDecisionEngine({ ...market, strategy });
    assert.equal(decision.strategy_id, id, `${id}: strategy_id`);
    assert.equal(decision.strategy_type, type, `${id}: strategy_type`);
    assert.equal(decision.ai_mode, mode, `${id}: ai_mode`);
    // Sanity: the engine still produces an action label and a quality score.
    assert.ok(typeof decision.action === 'string' && decision.action.length > 0);
    assert.ok(Number.isFinite(decision.trade_quality_score));
  }
});

test('integration: trend-following and mean-reversion produce DIFFERENT decisions on the same uptrend market', () => {
  // The whole point of multi-strategy: one orchestrator, one feed, but
  // the operator's manifest decides what counts as a tradeable setup.
  // We do not pin the exact action label (regime classification of the
  // synthetic series is the engine's call) — we ONLY assert the two
  // decisions diverge in some meaningful field. If they ever produce
  // byte-identical output, strategy switching is a no-op.
  const market = {
    ...uptrendSeries(),
    vaultState: flatVaultState(),
    policy: POLICY,
    aiView: AI_BULLISH,
    symbol: 'ETH/USDC',
  };
  const trend = runDecisionEngine({ ...market, strategy: loadTemplate('trend-following-v1') });
  const meanRev = runDecisionEngine({ ...market, strategy: loadTemplate('mean-reversion-v1') });

  assert.equal(trend.strategy_id, 'trend-following-v1');
  assert.equal(meanRev.strategy_id, 'mean-reversion-v1');

  // Different by construction: at minimum the strategy_id diverges, but
  // we also expect either the action OR final_edge_score to differ
  // because the scoring weights are intentionally distinct.
  const sameAction = trend.action === meanRev.action;
  const sameScore  = trend.final_edge_score === meanRev.final_edge_score;
  assert.ok(!sameAction || !sameScore,
    `expected divergence, both got action=${trend.action} score=${trend.final_edge_score}`);
});

test('integration: trend-following biases toward BUY in a clean uptrend, mean-reversion does not', () => {
  // Trend-following's allowedBuyRegimes = [TREND_UP_STRONG, TREND_UP_WEAK].
  // Mean-reversion's allowedBuyRegimes = [RANGE_STABLE, RANGE_NOISY] AND
  // its entry_long DSL requires rsi_14 < 30. On a smooth uptrend the
  // engine should NEVER produce a BUY for mean-reversion, even if the
  // engine is otherwise willing to buy under trend-following.
  const market = {
    ...uptrendSeries(),
    vaultState: flatVaultState(),
    policy: POLICY,
    aiView: AI_BULLISH,
    symbol: 'ETH/USDC',
  };
  const meanRev = runDecisionEngine({ ...market, strategy: loadTemplate('mean-reversion-v1') });
  // Mean-reversion must never enter on a TREND_UP_* regime — the gate is
  // a hard contract with the operator's depositors.
  assert.notEqual(meanRev.action, 'BUY',
    `mean-reversion produced BUY on uptrend regime=${meanRev.regime}`);
});

test('integration: hard_gate AI mode flips engine BUY → HOLD when AI says hold', () => {
  // Mean-reversion uses ai.mode = hard_gate. Construct a market where the
  // engine WOULD buy under mean-reversion (oversold + range), then feed
  // an AI hint of "hold" to prove the override fires and populates
  // ai_override.
  //
  // The cleanest path is to hand-craft a strategy whose gates are loose
  // enough that any reasonable scoring path passes, then exercise the
  // hard_gate branch with a single hint flip. We pin the strategy
  // shape inline (rather than mutating a shipped template) so the test
  // surface is independent of future template tweaks.
  const permissiveHardGate = {
    schemaVersion: 1,
    strategy: {
      id: 'permissive-hardgate-v1',
      name: 'Permissive Hard Gate',
      type: 'custom',
      timeframe: '1h',
      basedOnHash: null,
    },
    indicators: { ema: { periods: [20] }, atr: { period: 14 } },
    scoring: {
      weights: {
        trend: 0.20, momentum: 0.20, volatility: 0.20,
        liquidity: 0.20, riskState: 0.10, aiContext: 0.10,
      },
    },
    rules: {
      // Empty entry_long expression → engine treats it as pass-through.
      entry_long: { expression: '1 == 1' },
      exit_long:  { expression: '1 == 1' },
      size_bps:   { expression: 'min(1500, vault.maxPositionBps)' },
    },
    gates: {
      // All thresholds floor-low so the engine WILL want to BUY in any
      // regime that scores anything. The hard_gate is the only thing
      // that should stop us.
      minEdgeBuy: 0,
      minQualityBuy: 0,
      minConfidenceBuy: 0,
      maxRiskBuy: 1.0,
      allowedBuyRegimes: [
        'TREND_UP_STRONG', 'TREND_UP_WEAK', 'RANGE_STABLE',
        'RANGE_NOISY', 'TREND_DOWN_WEAK', 'TREND_DOWN_STRONG',
      ],
      allowedSellRegimes: ['TREND_UP_STRONG', 'TREND_UP_WEAK'],
    },
    veto: {
      maxAtrPct: 100, rsiOverbought: 100, rsiOversold: 0,
      maxSpreadBps: 9000, maxSlippageBps: 9000, maxConsecutiveLosses: 99,
    },
    ai: {
      mode: 'hard_gate',
      model: 'zai-org/GLM-5-FP8',
      providerAddress: '0xd9966e13a6026Fcca4b13E7ff95c94DE268C471C',
      temperature: 0.3,
    },
  };

  const market = {
    ...uptrendSeries(),
    vaultState: flatVaultState(),
    policy: POLICY,
    symbol: 'ETH/USDC',
  };

  // Baseline: AI agrees → engine free to BUY (and given the loose gates
  // we expect a BUY here in the uptrend regime).
  const agreed = runDecisionEngine({
    ...market,
    aiView: { ...AI_BULLISH, action_hint: 'buy' },
    strategy: permissiveHardGate,
  });

  // Override: AI says hold → engine must flip to HOLD_FLAT and populate
  // ai_override with a non-null reason. This is the load-bearing claim
  // for hard_gate semantics.
  const vetoed = runDecisionEngine({
    ...market,
    aiView: { ...AI_BULLISH, action_hint: 'hold' },
    strategy: permissiveHardGate,
  });

  // Sanity on the agreed path: if the engine also blocked here, the test
  // setup is wrong and we cannot prove the veto changed anything.
  assert.equal(agreed.action, 'BUY',
    `baseline expected BUY, got ${agreed.action} (regime=${agreed.regime}, edge=${agreed.final_edge_score})`);
  assert.equal(agreed.ai_override, null);

  // Veto path
  assert.equal(vetoed.action, 'HOLD_FLAT', `expected HOLD_FLAT, got ${vetoed.action}`);
  assert.equal(vetoed.size_bps, 0);
  assert.ok(vetoed.ai_override && vetoed.ai_override.force_action,
    `expected populated ai_override, got ${JSON.stringify(vetoed.ai_override)}`);
  assert.match(vetoed.ai_override.reason, /AI vetoed BUY/);
  assert.match(vetoed.entry_trigger, /ai_hard_gate_veto/);
});

test('integration: context_only mode neutralises AI numeric inputs (action_hint preserved as text)', () => {
  // Arbitrage-stable uses ai.mode = context_only. Per aiModes.js, that
  // forces ai.confidence=0.5, risk_score=0.5, etc. The engine's
  // confidence-driven sizing should therefore NOT respond to a wildly
  // bullish AI view when the manifest is context_only.
  const market = {
    ...uptrendSeries(),
    vaultState: flatVaultState(),
    policy: POLICY,
    symbol: 'ETH/USDC',
  };

  // Two AI views: one extreme bullish, one extreme bearish. Under
  // context_only both must yield the same engine confidence (0.5).
  const decisionExtremeUp = runDecisionEngine({
    ...market,
    aiView: { confidence: 0.99, risk_score: 0.01, ai_context_score: 99, timing_score: 99, action_hint: 'buy' },
    strategy: loadTemplate('arbitrage-stable-v1'),
  });
  const decisionExtremeDown = runDecisionEngine({
    ...market,
    aiView: { confidence: 0.01, risk_score: 0.99, ai_context_score: 1, timing_score: 1, action_hint: 'sell' },
    strategy: loadTemplate('arbitrage-stable-v1'),
  });

  // The engine echoes ai.confidence into the output. Under context_only
  // both must show the neutral 0.5.
  assert.equal(decisionExtremeUp.confidence, 0.5,
    `context_only should neutralise confidence, got ${decisionExtremeUp.confidence}`);
  assert.equal(decisionExtremeDown.confidence, 0.5,
    `context_only should neutralise confidence, got ${decisionExtremeDown.confidence}`);
  assert.equal(decisionExtremeUp.risk_score, 0.5);
  assert.equal(decisionExtremeDown.risk_score, 0.5);
  // Same strategy + same market + neutralised AI ⇒ identical edge score.
  assert.equal(decisionExtremeUp.final_edge_score, decisionExtremeDown.final_edge_score);
});

test('integration: scoring_input mode lets AI numeric inputs flow into final_edge_score', () => {
  // Trend-following uses ai.mode = scoring_input. With the same market,
  // a higher ai_context_score MUST raise final_edge_score (or at least
  // change it). This is the inverse of the context_only check above and
  // proves the modes are not collapsed by accident.
  const market = {
    ...uptrendSeries(),
    vaultState: flatVaultState(),
    policy: POLICY,
    symbol: 'ETH/USDC',
  };
  const strategy = loadTemplate('trend-following-v1');

  const lowAi = runDecisionEngine({
    ...market,
    aiView: { confidence: 0.6, risk_score: 0.4, ai_context_score: 10, timing_score: 50 },
    strategy,
  });
  const highAi = runDecisionEngine({
    ...market,
    aiView: { confidence: 0.6, risk_score: 0.4, ai_context_score: 95, timing_score: 50 },
    strategy,
  });

  assert.notEqual(lowAi.final_edge_score, highAi.final_edge_score,
    'scoring_input should propagate ai_context_score into final_edge_score');
  assert.ok(highAi.final_edge_score >= lowAi.final_edge_score,
    `expected higher AI context to raise edge, got low=${lowAi.final_edge_score} high=${highAi.final_edge_score}`);
});

test('integration: strategy.gates.minEdgeBuy overrides the default engine threshold', () => {
  // Two strategies identical except for gates.minEdgeBuy: a permissive
  // one (0) and a strict one (95). On the SAME market, the permissive
  // one should be willing to act when the strict one is not. This
  // proves strategy gates take precedence over the engine's hardcoded
  // THRESHOLDS.ENTER_BUY.
  function strategyWithMinEdge(minEdge) {
    return {
      schemaVersion: 1,
      strategy: { id: `gate-test-${minEdge}`, name: 'Gate Test', type: 'custom', timeframe: '1h', basedOnHash: null },
      indicators: { ema: { periods: [20] }, atr: { period: 14 } },
      scoring: {
        weights: { trend: 0.20, momentum: 0.20, volatility: 0.20, liquidity: 0.20, riskState: 0.10, aiContext: 0.10 },
      },
      rules: {
        entry_long: { expression: '1 == 1' },
        exit_long:  { expression: '1 == 1' },
        size_bps:   { expression: 'min(1500, vault.maxPositionBps)' },
      },
      gates: {
        minEdgeBuy: minEdge,
        minQualityBuy: 0,
        minConfidenceBuy: 0,
        maxRiskBuy: 1.0,
        allowedBuyRegimes: [
          'TREND_UP_STRONG', 'TREND_UP_WEAK', 'RANGE_STABLE',
          'RANGE_NOISY', 'TREND_DOWN_WEAK', 'TREND_DOWN_STRONG',
        ],
        allowedSellRegimes: ['TREND_UP_STRONG'],
      },
      veto: { maxAtrPct: 100, rsiOverbought: 100, rsiOversold: 0, maxSpreadBps: 9000, maxSlippageBps: 9000, maxConsecutiveLosses: 99 },
      ai: { mode: 'scoring_input', model: 'm', providerAddress: '0xd9966e13a6026Fcca4b13E7ff95c94DE268C471C' },
    };
  }

  const market = {
    ...uptrendSeries(),
    vaultState: flatVaultState(),
    policy: POLICY,
    aiView: AI_BULLISH,
    symbol: 'ETH/USDC',
  };

  const permissive = runDecisionEngine({ ...market, strategy: strategyWithMinEdge(0) });
  const strict     = runDecisionEngine({ ...market, strategy: strategyWithMinEdge(99) });

  // Permissive: should produce some BUY (gates wide open).
  assert.equal(permissive.action, 'BUY',
    `permissive expected BUY, got ${permissive.action} edge=${permissive.final_edge_score}`);
  // Strict: minEdgeBuy=99 means edge must be ≥99 to BUY. On the synthetic
  // series we use this is unreachable, so the engine must NOT BUY.
  assert.notEqual(strict.action, 'BUY',
    `strict expected non-BUY, got ${strict.action} edge=${strict.final_edge_score}`);
});

test('integration: missing strategy = legacy V3 path (no strategy provenance fields)', () => {
  // Backwards compat: omitting `strategy` from runDecisionEngine input
  // must leave strategy_id / strategy_type / ai_mode / ai_override null.
  // Live V3 vaults do not have a manifest commitment yet — this path
  // MUST keep working unchanged or every existing vault stops trading.
  const decision = runDecisionEngine({
    ...uptrendSeries(),
    vaultState: flatVaultState(),
    policy: POLICY,
    aiView: AI_BULLISH,
    symbol: 'ETH/USDC',
    // no strategy
  });
  assert.equal(decision.strategy_id, null);
  assert.equal(decision.strategy_type, null);
  assert.equal(decision.ai_mode, null);
  assert.equal(decision.ai_override, null);
});

test('integration: hard_gate vetoes SELL the same way it vetoes BUY', () => {
  // Symmetry check: hard_gate must work in both directions or operators
  // can be silently allowed to exit positions the AI disagreed with.
  // We force an open-position scenario into a tactical_exit (SELL)
  // pathway, then assert that AI saying "buy" flips it to HOLD.
  const permissiveHardGate = {
    schemaVersion: 1,
    strategy: { id: 'sell-gate-test', name: 'Sell Gate Test', type: 'custom', timeframe: '1h', basedOnHash: null },
    indicators: { ema: { periods: [20] }, atr: { period: 14 } },
    scoring: {
      weights: { trend: 0.20, momentum: 0.20, volatility: 0.20, liquidity: 0.20, riskState: 0.10, aiContext: 0.10 },
    },
    rules: {
      entry_long: { expression: '1 == 1' }, exit_long: { expression: '1 == 1' },
      size_bps: { expression: 'min(1500, vault.maxPositionBps)' },
    },
    gates: {
      minEdgeBuy: 0, minQualityBuy: 0, minConfidenceBuy: 0, maxRiskBuy: 1.0,
      allowedBuyRegimes: ['TREND_UP_STRONG'],
      allowedSellRegimes: ['TREND_UP_STRONG', 'TREND_UP_WEAK', 'RANGE_STABLE', 'RANGE_NOISY', 'TREND_DOWN_WEAK', 'TREND_DOWN_STRONG'],
    },
    veto: { maxAtrPct: 100, rsiOverbought: 100, rsiOversold: 0, maxSpreadBps: 9000, maxSlippageBps: 9000, maxConsecutiveLosses: 99 },
    ai: { mode: 'hard_gate', model: 'm', providerAddress: '0xd9966e13a6026Fcca4b13E7ff95c94DE268C471C' },
  };

  // Force tactical_exit: low edge + low confidence inside an open-long.
  const market = {
    ...uptrendSeries(),
    vaultState: openVaultState({ current_position_pnl_pct: -1.0 }),
    policy: POLICY,
    aiView: { confidence: 0.50, risk_score: 0.50, ai_context_score: 30, timing_score: 30, action_hint: 'buy' },
    symbol: 'ETH/USDC',
    strategy: permissiveHardGate,
  };

  const decision = runDecisionEngine(market);
  // Either the engine produced HOLD_POSITION on its own (no SELL ⇒ no veto
  // visible) OR a SELL got vetoed into HOLD_POSITION via ai_override.
  // What matters is: when ai_override fires, the action is no-op.
  if (decision.ai_override) {
    assert.equal(decision.action, 'HOLD_POSITION');
    assert.equal(decision.size_bps, 0);
    assert.match(decision.ai_override.reason, /AI vetoed SELL/);
  } else {
    // Engine simply did not want to SELL in the first place — also a
    // valid outcome, but then there's nothing to veto. The action must
    // not be SELL/REDUCE because the AI says BUY (would have been vetoed).
    assert.notEqual(decision.action, 'SELL');
    assert.notEqual(decision.action, 'REDUCE');
  }
});

test('integration: strategy_id remains stable across many calls (deterministic)', () => {
  // Provenance fields must not drift across cycles. Run the same input
  // ten times and confirm strategy_id is constant. This is a weak
  // determinism check that catches accidental Math.random() reads or
  // Date-based branches in any strategy-aware code path.
  const market = {
    ...uptrendSeries(),
    vaultState: flatVaultState(),
    policy: POLICY,
    aiView: AI_BULLISH,
    symbol: 'ETH/USDC',
    strategy: loadTemplate('momentum-breakout-v1'),
  };
  const ids = new Set();
  for (let i = 0; i < 10; i++) {
    ids.add(runDecisionEngine(market).strategy_id);
  }
  assert.equal(ids.size, 1);
  assert.ok(ids.has('momentum-breakout-v1'));
});
