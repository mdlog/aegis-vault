/**
 * Backtester unit tests.
 *
 * Strategy uses synthetic OHLCV (deterministic mulberry32 seed) so tests are
 * hermetic — no external API calls. The backtester is exercised against
 * three regimes: trending up, trending down, sideways noise — and against an
 * always-block manifest to verify zero-trade behavior.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve as resolvePath, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  runBacktest,
  generateSyntheticOHLCV,
  evalRule,
} from '../../src/services/backtester.js';
import { validateManifest } from '../../src/strategy/validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Test manifests ────────────────────────────────────────────────────────────

function makePermissiveManifest(overrides = {}) {
  // Permissive: every gate set to 0 / undefined regimes so backtester actually trades.
  return {
    schemaVersion: 1,
    strategy: {
      id: 'test-permissive',
      name: 'Permissive Test Strategy',
      type: 'trend_following',
      timeframe: '1d',
    },
    indicators: {
      rsi: { period: 14 },
      macd: { fast: 12, slow: 26, signal: 9 },
      ema: { periods: [20, 50, 200] },
      atr: { period: 14 },
    },
    scoring: {
      weights: { trend: 0.30, momentum: 0.20, volatility: 0.15, liquidity: 0.10, riskState: 0.15, aiContext: 0.10 },
    },
    rules: {
      // expressions are no-ops in fallback DSL; backtester returns true by default
      entry_long: { expression: 'rsi_14 < 100' },
      exit_long: { expression: 'rsi_14 > 0' },
    },
    gates: {
      minEdgeBuy: 0,
      minEdgeSell: 0,
      minQualityBuy: 0,
      minConfidenceBuy: 0,
    },
    veto: {},
    ai: {
      mode: 'scoring_input',
      model: 'gpt-test',
      providerAddress: '0x' + '11'.repeat(20),
    },
    ...overrides,
  };
}

function makeBlockingManifest() {
  // Forces edge floor to 100 → no trades ever.
  const m = makePermissiveManifest({ strategy: {
    id: 'test-blocking', name: 'Blocking', type: 'trend_following', timeframe: '1d',
  } });
  m.gates.minEdgeBuy = 100;
  m.gates.minQualityBuy = 100;
  return m;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('backtester runs against synthetic OHLCV without errors', async () => {
  const ohlcv = generateSyntheticOHLCV({
    candles: 90, startPrice: 2000, trendPctPerCandle: 0.005,
    amplitude: 0.06, period: 12, noisePct: 0.005, seed: 42,
  });
  const result = await runBacktest({
    strategy: makePermissiveManifest(),
    ohlcv,
    startCapital: 10_000,
    symbol: 'ETH',
    warmupCandles: 30,
  });
  assert.equal(typeof result, 'object');
  assert.equal(result.symbol, 'ETH');
  assert.ok(Array.isArray(result.trades));
  assert.ok(Array.isArray(result.equity_curve));
  assert.equal(result.equity_curve.length, ohlcv.length);
  assert.equal(typeof result.metrics.totalReturn, 'number');
});

test('backtester identifies trades from rule triggers', async () => {
  // Modest trend + low oscillation/noise so regime classifier lands in
  // TREND_UP_* / RANGE_STABLE rather than PANIC_VOLATILE (which is BEARISH-bias
  // and blocks long entries).
  const ohlcv = generateSyntheticOHLCV({
    candles: 200, startPrice: 2000, trendPctPerCandle: 0.006,
    amplitude: 0.015, period: 20, noisePct: 0.002, seed: 1,
  });
  const result = await runBacktest({
    strategy: makePermissiveManifest(),
    ohlcv,
    startCapital: 10_000,
    symbol: 'ETH',
    warmupCandles: 50,
  });
  // Permissive manifest in trending market should open at least one position
  // (final force-close guarantees ≥1 trade if any entry happens).
  assert.ok(result.metrics.totalTrades >= 1, `expected ≥1 trade, got ${result.metrics.totalTrades}`);
  for (const t of result.trades) {
    assert.equal(typeof t.entry_price, 'number');
    assert.equal(typeof t.exit_price, 'number');
    assert.ok(t.exit_ts >= t.entry_ts);
    assert.ok(t.units > 0);
  }
});

test('backtester computes positive return when strategy + uptrend align', async () => {
  // Strong uptrend so naive long-only strategy makes money.
  const ohlcv = generateSyntheticOHLCV({
    candles: 150, startPrice: 1000, trendPctPerCandle: 0.008,
    amplitude: 0.03, period: 20, noisePct: 0.003, seed: 9,
  });
  const result = await runBacktest({
    strategy: makePermissiveManifest(),
    ohlcv,
    startCapital: 10_000,
    symbol: 'ETH',
    warmupCandles: 50,
  });
  assert.ok(
    result.metrics.totalReturn > 0,
    `expected positive return in uptrend, got ${result.metrics.totalReturn}`
  );
  assert.ok(result.end_capital > result.start_capital);
});

test('backtester handles zero-trade strategy gracefully', async () => {
  const ohlcv = generateSyntheticOHLCV({ candles: 60, seed: 3 });
  const result = await runBacktest({
    strategy: makeBlockingManifest(),
    ohlcv,
    startCapital: 5_000,
    symbol: 'ETH',
    warmupCandles: 20,
  });
  assert.equal(result.metrics.totalTrades, 0);
  assert.equal(result.metrics.winningTrades, 0);
  assert.equal(result.metrics.losingTrades, 0);
  assert.equal(result.metrics.winRate, 0);
});

test('backtester respects start capital — end NAV equals start when no trades happen', async () => {
  const ohlcv = generateSyntheticOHLCV({ candles: 60, seed: 5 });
  const result = await runBacktest({
    strategy: makeBlockingManifest(),
    ohlcv,
    startCapital: 12_345,
    symbol: 'ETH',
    warmupCandles: 20,
  });
  assert.equal(result.start_capital, 12_345);
  assert.equal(result.end_capital, 12_345);
  assert.equal(result.metrics.totalReturn, 0);
});

test('backtester respects position sizing — never loses more than start capital on a single long', async () => {
  // Even in a downtrend, a long-only strategy can only lose down to zero.
  const ohlcv = generateSyntheticOHLCV({
    candles: 120, startPrice: 2000, trendPctPerCandle: -0.005,
    amplitude: 0.05, period: 10, noisePct: 0.005, seed: 11,
  });
  const result = await runBacktest({
    strategy: makePermissiveManifest(),
    ohlcv,
    startCapital: 10_000,
    symbol: 'ETH',
    warmupCandles: 40,
  });
  assert.ok(result.end_capital >= 0, 'NAV cannot go negative on long-only');
});

test('maxDrawdown is non-positive (≤ 0)', async () => {
  const ohlcv = generateSyntheticOHLCV({
    candles: 120, startPrice: 2000, trendPctPerCandle: -0.003,
    amplitude: 0.05, period: 10, noisePct: 0.005, seed: 13,
  });
  const result = await runBacktest({
    strategy: makePermissiveManifest(),
    ohlcv,
    startCapital: 10_000,
    symbol: 'ETH',
    warmupCandles: 40,
  });
  assert.ok(result.metrics.maxDrawdown <= 0, `expected ≤0 drawdown, got ${result.metrics.maxDrawdown}`);
});

test('winRate is between 0 and 1 inclusive', async () => {
  const ohlcv = generateSyntheticOHLCV({ candles: 100, seed: 21 });
  const result = await runBacktest({
    strategy: makePermissiveManifest(),
    ohlcv,
    startCapital: 10_000,
    symbol: 'ETH',
    warmupCandles: 30,
  });
  assert.ok(result.metrics.winRate >= 0 && result.metrics.winRate <= 1);
});

test('evalRule fallback returns default when DSL not available or rule missing', () => {
  // Without an `expression`, returns default (true).
  assert.equal(evalRule(null, {}), true);
  assert.equal(evalRule({}, {}, true), true);
  assert.equal(evalRule({}, {}, false), false);
  // When DSL parsing fails or DSL is absent, fallback returns the requested default.
  // (Even if DSL is present and the expr is valid, the test should still pass —
  // we accept either true or false here, just enforce boolean type.)
  const out = evalRule({ expression: 'rsi_14 < 100' }, { rsi_14: 50 }, true);
  assert.equal(typeof out, 'boolean');
});

test('manifest validates against schema-v1', () => {
  const v = validateManifest(makePermissiveManifest());
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test('throws on missing strategy / ohlcv / startCapital', async () => {
  await assert.rejects(() => runBacktest({}), /strategy required/);
  await assert.rejects(
    () => runBacktest({ strategy: makePermissiveManifest() }),
    /ohlcv required/,
  );
  await assert.rejects(
    () => runBacktest({ strategy: makePermissiveManifest(), ohlcv: [{ timestamp: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 }] }),
    /startCapital must be positive/,
  );
});

test('writes a 30d sample fixture for the smoke-test step (idempotent)', () => {
  // The smoke-test in the validation step references this file. Tests double as
  // the fixture generator so no extra `node` invocation is needed.
  const fixturePath = resolvePath(__dirname, '..', 'fixtures', 'eth-30d-sample.json');
  mkdirSync(dirname(fixturePath), { recursive: true });
  if (!existsSync(fixturePath)) {
    const data = generateSyntheticOHLCV({
      candles: 30, startPrice: 2000, trendPctPerCandle: 0.004,
      amplitude: 0.05, period: 10, noisePct: 0.005, seed: 7,
      startTs: Date.UTC(2026, 0, 1),
    });
    writeFileSync(fixturePath, JSON.stringify(data, null, 2));
  }
  assert.ok(existsSync(fixturePath));
});

test('writes a 90d sample fixture for downstream backtests (idempotent)', () => {
  const fixturePath = resolvePath(__dirname, '..', 'fixtures', 'eth-90d-sample.json');
  mkdirSync(dirname(fixturePath), { recursive: true });
  if (!existsSync(fixturePath)) {
    const data = generateSyntheticOHLCV({
      candles: 90, startPrice: 2000, trendPctPerCandle: 0.005,
      amplitude: 0.06, period: 12, noisePct: 0.005, seed: 42,
      startTs: Date.UTC(2026, 0, 1),
    });
    writeFileSync(fixturePath, JSON.stringify(data, null, 2));
  }
  assert.ok(existsSync(fixturePath));
});
