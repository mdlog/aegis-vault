/**
 * Strategy Backtester
 * ===================
 *
 * Replays a strategy manifest against historical OHLCV candles and produces
 * trade metrics so operators can validate a manifest *before* publishing it.
 *
 * Pure module: no I/O, no globals, no external services. CLI wraps it.
 *
 * Pipeline per candle (chronological):
 *   1. Build prices/volumes window up to that candle.
 *   2. computeAllIndicators(window, close, volume).
 *   3. classifyRegime(indicators).
 *   4. computeAllScores using strategy.scoring.weights (NOT hard-coded weights).
 *   5. Evaluate strategy.rules.entry_long / exit_long via DSL (or fallback).
 *   6. Apply strategy.gates (minEdgeBuy, minQualityBuy, minConfidenceBuy,
 *      allowedBuyRegimes) before opening; mirror minEdgeSell on close.
 *   7. Open / close position at the candle close price (no intra-bar fills).
 *   8. Track NAV + drawdown.
 *
 * Returns BacktestResult { trades, metrics, equity_curve }.
 */

import {
  computeAllIndicators,
} from './indicators.js';
import {
  classifyRegime,
  regimeBias,
  regimeSuitability,
} from './regimeClassifier.js';
import {
  computeTrendScore,
  computeMomentumScore,
  computeVolatilityScore,
  computeLiquidityScore,
  computeRiskStateScore,
  computeTradeQualityScore,
} from './signalScoring.js';

// ── DSL fallback (Phase 1 Agent B may not be ready yet) ───────────────────────
let dsl = null;
try {
  // eslint-disable-next-line import/no-unresolved
  dsl = await import('../strategy/dsl.js');
} catch {
  // Fallback: rules are no-ops that always return true. Phase 2 wires real DSL.
  dsl = null;
}

/**
 * Evaluate a rule's expression string against the runtime context.
 * Returns the truthy/falsy result of the expression. When the DSL is not
 * available, returns `defaultValue` so the backtester is still functional.
 *
 * Supports two DSL APIs:
 *   - Legacy: dsl.parseExpression(expr) → AST; dsl.evaluateExpression(ast, ctx)
 *   - Current (Phase 1 Agent B): dsl.evaluateExpression(source, ctx) — caches AST internally
 */
export function evalRule(ruleObj, ctx, defaultValue = true) {
  if (!ruleObj || typeof ruleObj !== 'object') return defaultValue;
  const expr = ruleObj.expression;
  if (!expr || typeof expr !== 'string') return defaultValue;
  if (!dsl) return defaultValue;
  try {
    // Prefer the Phase-1B API: evaluateExpression(source, context).
    if (typeof dsl.evaluateExpression === 'function' && dsl.evaluateExpression.length >= 2) {
      const value = dsl.evaluateExpression(expr, ctx);
      return Boolean(value);
    }
    // Fall back to legacy two-step API.
    if (typeof dsl.parseExpression === 'function') {
      const ast = dsl.parseExpression(expr);
      const value = dsl.evaluateExpression
        ? dsl.evaluateExpression(ast, ctx)
        : dsl.evaluateAst?.(ast, ctx);
      return Boolean(value);
    }
    if (typeof dsl.parseDsl === 'function' && typeof dsl.evaluateAst === 'function') {
      const ast = dsl.parseDsl(expr);
      return Boolean(dsl.evaluateAst(ast, ctx));
    }
    return defaultValue;
  } catch {
    // DSL parse/eval failure → conservative fallback (skip this trade).
    return false;
  }
}

/**
 * Compute weighted final edge score using the strategy's scoring weights.
 * Mirrors signalScoring.computeFinalEdgeScore but reads weights from manifest.
 */
function computeWeightedEdge(scores, weights) {
  return Math.round(
    weights.trend * scores.trend +
    weights.momentum * scores.momentum +
    weights.volatility * scores.volatility +
    weights.liquidity * scores.liquidity +
    weights.riskState * scores.riskState +
    weights.aiContext * scores.aiContext
  );
}

/**
 * Walk OHLCV history and simulate strategy.
 *
 * @param {object} args
 * @param {object} args.strategy            Validated strategy manifest object.
 * @param {Array<{timestamp:number,open:number,high:number,low:number,close:number,volume:number}>} args.ohlcv
 * @param {number} args.startCapital        Initial USD balance.
 * @param {string} args.symbol              Asset symbol traded (e.g. 'ETH').
 * @param {string} [args.asset='USDC']      Quote currency.
 * @param {number} [args.warmupCandles=200] Skip until enough history for EMA200.
 * @param {boolean}[args.verbose=false]     Per-candle decision dump (returned, not printed).
 * @returns {object} BacktestResult
 */
export async function runBacktest({
  strategy,
  ohlcv,
  startCapital,
  symbol,
  asset = 'USDC',
  warmupCandles = 200,
  verbose = false,
}) {
  if (!strategy || typeof strategy !== 'object') throw new Error('strategy required');
  if (!Array.isArray(ohlcv) || ohlcv.length === 0) throw new Error('ohlcv required (non-empty array)');
  if (!Number.isFinite(startCapital) || startCapital <= 0) throw new Error('startCapital must be positive');

  const weights = strategy.scoring?.weights || {
    trend: 0.25, momentum: 0.20, volatility: 0.15, liquidity: 0.15, riskState: 0.15, aiContext: 0.10,
  };
  const gates = strategy.gates || {};
  const veto = strategy.veto || {};
  const minEdgeBuy = Number.isFinite(gates.minEdgeBuy) ? gates.minEdgeBuy : 0;
  const minEdgeSell = Number.isFinite(gates.minEdgeSell) ? gates.minEdgeSell : 0;
  const minQualityBuy = Number.isFinite(gates.minQualityBuy) ? gates.minQualityBuy : 0;
  const minConfBuy = Number.isFinite(gates.minConfidenceBuy) ? gates.minConfidenceBuy : 0;
  const allowedBuyRegimes = Array.isArray(gates.allowedBuyRegimes) ? new Set(gates.allowedBuyRegimes) : null;
  const allowedSellRegimes = Array.isArray(gates.allowedSellRegimes) ? new Set(gates.allowedSellRegimes) : null;

  // Position state
  let cashUsd = startCapital;
  let positionUnits = 0;          // base asset units held
  let positionEntryPrice = 0;
  let positionEntryTs = 0;
  const trades = [];
  const equityCurve = [];
  const decisionLog = [];

  // Track running peak for drawdown
  let peakNav = startCapital;
  let maxDrawdownPct = 0;

  // Daily returns for Sharpe (assume one candle = one period; period scaling below).
  const periodReturns = [];

  const startTs = ohlcv[0].timestamp;
  const endTs = ohlcv[ohlcv.length - 1].timestamp;
  const candleSpanMs = ohlcv.length > 1 ? Math.max(1, ohlcv[1].timestamp - ohlcv[0].timestamp) : 86_400_000;
  // periods/year for Sharpe annualization.
  const periodsPerYear = Math.max(1, Math.round((365 * 86_400_000) / candleSpanMs));

  // Pre-fill arrays we mutate per step
  const closes = [];
  const highs = [];
  const lows = [];
  const volumes = [];

  let prevNav = startCapital;

  for (let i = 0; i < ohlcv.length; i++) {
    const c = ohlcv[i];
    closes.push(c.close);
    highs.push(c.high);
    lows.push(c.low);
    volumes.push(c.volume);

    // NAV mark-to-market at this close.
    const nav = cashUsd + positionUnits * c.close;
    equityCurve.push({ timestamp: c.timestamp, nav, position: positionUnits, price: c.close });

    if (nav > peakNav) peakNav = nav;
    const ddPct = peakNav > 0 ? (nav - peakNav) / peakNav : 0;
    if (ddPct < maxDrawdownPct) maxDrawdownPct = ddPct;

    if (prevNav > 0) periodReturns.push((nav - prevNav) / prevNav);
    prevNav = nav;

    // Skip until we have enough history for EMA200.
    if (i < warmupCandles) continue;

    // Compute indicators
    const indicators = computeAllIndicators(
      { prices: closes, volumes, highs, lows },
      c.close,
      c.volume,
    );

    const regime = classifyRegime(indicators);
    const bias = regimeBias(regime);
    const regimeSuit = regimeSuitability(regime);

    // Subscores (vault state defaults — no live trading constraints in backtest).
    const vaultState = {
      consecutive_losses: 0,
      daily_pnl_pct: 0,
      rolling_drawdown_pct: Math.abs(maxDrawdownPct) * 100,
      actions_last_60m: 0,
      time_since_last_trade_sec: 9999,
    };
    const policy = { max_actions_per_60m: 2, cooldown_seconds: 0 };

    const trend = computeTrendScore(indicators);
    const momentum = computeMomentumScore(indicators);
    const volatility = computeVolatilityScore(indicators);
    const liquidity = computeLiquidityScore(indicators);
    const riskState = computeRiskStateScore(vaultState, policy);
    const aiContext = 50; // neutral — backtester does not call AI
    const subscores = { trend, momentum, volatility, liquidity, riskState, aiContext };
    const finalEdgeScore = computeWeightedEdge(subscores, weights);
    const tradeQuality = computeTradeQualityScore({
      finalEdgeScore,
      executionScore: 80,
      timingScore: 70,
      regimeSuitabilityScore: regimeSuit,
      confidenceScaled: 50,
    });

    // DSL context — Agent B's evaluator reads indicators via ctx.indicators.<name>
    // (nested namespace), so we pass the indicator bag wholesale plus regime,
    // ai, position, vault namespaces. Top-level spread is also kept for any
    // legacy/non-DSL consumer that walks the flat shape.
    // TODO: Phase 2 wires Agent B's evaluateExpression() directly here once
    // strategy.dsl.js exports stabilize.
    const ctx = {
      indicators,
      regime,
      ai: { confidence: 0.5, risk_score: 0.5, ai_context_score: aiContext, timing_score: 70 },
      position: positionUnits > 0 ? {
        pnl_pct: positionEntryPrice > 0 ? ((c.close - positionEntryPrice) / positionEntryPrice) * 100 : 0,
        holding_seconds: Math.max(0, (c.timestamp - positionEntryTs) / 1000),
      } : { pnl_pct: 0, holding_seconds: 0 },
      vault: { maxPositionBps: 10000, consecutive_losses: 0, balance: nav },
    };

    // Veto pre-check (hard veto: if violated, skip both entry & exit).
    let vetoed = false;
    const vetoReasons = [];
    if (Number.isFinite(veto.maxAtrPct) && indicators.atr_14_pct > veto.maxAtrPct) {
      vetoed = true; vetoReasons.push('atr');
    }
    if (Number.isFinite(veto.maxSpreadBps) && indicators.spread_bps > veto.maxSpreadBps) {
      vetoed = true; vetoReasons.push('spread');
    }
    if (Number.isFinite(veto.maxSlippageBps) && indicators.slippage_estimate_bps > veto.maxSlippageBps) {
      vetoed = true; vetoReasons.push('slippage');
    }

    // Decide action
    let action = 'hold';
    let actionReason = '';

    if (positionUnits > 0) {
      // EXIT path
      const exitRule = strategy.rules?.exit_long;
      const ruleMet = exitRule ? evalRule(exitRule, ctx, false) : false;
      const regimeOk = !allowedSellRegimes || allowedSellRegimes.has(regime);
      const edgeOk = finalEdgeScore >= 0; // sell edge is "willingness to exit", not strict gate
      // For exits, strategy minEdgeSell acts as a confidence floor on the sell signal.
      // We treat it as: only force-exit when finalEdgeScore drops below it OR rule matches.
      const forceExit = finalEdgeScore < minEdgeSell;
      if (!vetoed && (ruleMet || forceExit) && regimeOk && edgeOk) {
        // Close position at close price.
        const exitNotional = positionUnits * c.close;
        const entryNotional = positionUnits * positionEntryPrice;
        const pnl = exitNotional - entryNotional;
        const pnlPct = entryNotional > 0 ? pnl / entryNotional : 0;
        const holdMs = c.timestamp - positionEntryTs;
        cashUsd += exitNotional;
        trades.push({
          side: 'long',
          entry_ts: positionEntryTs,
          entry_price: positionEntryPrice,
          exit_ts: c.timestamp,
          exit_price: c.close,
          units: positionUnits,
          pnl_usd: pnl,
          pnl_pct: pnlPct,
          holding_ms: holdMs,
          exit_reason: ruleMet ? 'rule' : 'force_edge_floor',
          regime_at_exit: regime,
        });
        positionUnits = 0;
        positionEntryPrice = 0;
        positionEntryTs = 0;
        action = 'sell';
        actionReason = ruleMet ? 'exit_rule' : 'edge_below_floor';
      }
    } else {
      // ENTRY path
      const entryRule = strategy.rules?.entry_long;
      const ruleMet = entryRule ? evalRule(entryRule, ctx, true) : true;
      const regimeOk = !allowedBuyRegimes || allowedBuyRegimes.has(regime);
      const edgeOk = finalEdgeScore >= minEdgeBuy;
      const qualityOk = tradeQuality >= minQualityBuy;
      const confOk = 0.5 >= minConfBuy; // backtest uses neutral 0.5 confidence
      const biasOk = bias !== 'BEARISH'; // never long in bearish regime by default

      if (!vetoed && ruleMet && regimeOk && edgeOk && qualityOk && confOk && biasOk) {
        // Determine size via rules.size_bps if present; default 100% of cash.
        let sizeBps = 10_000;
        if (strategy.rules?.size_bps?.expression && dsl) {
          try {
            const src = strategy.rules.size_bps.expression;
            let v;
            if (typeof dsl.evaluateExpression === 'function' && dsl.evaluateExpression.length >= 2) {
              v = Number(dsl.evaluateExpression(src, ctx));
            } else if (typeof dsl.parseExpression === 'function' && typeof dsl.evaluateExpression === 'function') {
              v = Number(dsl.evaluateExpression(dsl.parseExpression(src), ctx));
            } else if (typeof dsl.parseDsl === 'function' && typeof dsl.evaluateAst === 'function') {
              v = Number(dsl.evaluateAst(dsl.parseDsl(src), ctx));
            }
            if (Number.isFinite(v) && v > 0) sizeBps = Math.min(10_000, Math.max(1, v));
          } catch { /* keep default */ }
        }
        const notional = (cashUsd * sizeBps) / 10_000;
        if (notional > 0 && c.close > 0) {
          positionUnits = notional / c.close;
          positionEntryPrice = c.close;
          positionEntryTs = c.timestamp;
          cashUsd -= notional;
          action = 'buy';
          actionReason = `entry_rule edge=${finalEdgeScore} q=${tradeQuality}`;
        }
      } else if (vetoed) {
        actionReason = `veto:${vetoReasons.join(',')}`;
      } else {
        actionReason = `gate_block ruleMet=${ruleMet} regime=${regime} edge=${finalEdgeScore}/${minEdgeBuy}`;
      }
    }

    if (verbose) {
      decisionLog.push({
        i,
        ts: c.timestamp,
        price: c.close,
        regime,
        edge: finalEdgeScore,
        quality: tradeQuality,
        action,
        reason: actionReason,
        position: positionUnits,
        nav,
      });
    }
  }

  // Force-close any open position at the final close (mark-to-market realization).
  if (positionUnits > 0) {
    const last = ohlcv[ohlcv.length - 1];
    const exitNotional = positionUnits * last.close;
    const entryNotional = positionUnits * positionEntryPrice;
    const pnl = exitNotional - entryNotional;
    const pnlPct = entryNotional > 0 ? pnl / entryNotional : 0;
    cashUsd += exitNotional;
    trades.push({
      side: 'long',
      entry_ts: positionEntryTs,
      entry_price: positionEntryPrice,
      exit_ts: last.timestamp,
      exit_price: last.close,
      units: positionUnits,
      pnl_usd: pnl,
      pnl_pct: pnlPct,
      holding_ms: last.timestamp - positionEntryTs,
      exit_reason: 'final_close',
      regime_at_exit: 'unknown',
    });
    positionUnits = 0;
  }

  const endNav = cashUsd;
  const totalReturn = (endNav - startCapital) / startCapital;

  const winningTrades = trades.filter((t) => t.pnl_usd > 0).length;
  const losingTrades = trades.filter((t) => t.pnl_usd < 0).length;
  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;
  const avgHoldingMs = totalTrades > 0 ? trades.reduce((s, t) => s + t.holding_ms, 0) / totalTrades : 0;
  const avgHoldingDays = avgHoldingMs / 86_400_000;

  // Sharpe: mean(returns)/std(returns) * sqrt(periodsPerYear).
  let sharpeRatio = 0;
  if (periodReturns.length > 1) {
    const mean = periodReturns.reduce((s, r) => s + r, 0) / periodReturns.length;
    const variance = periodReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / periodReturns.length;
    const std = Math.sqrt(variance);
    if (std > 0) sharpeRatio = (mean / std) * Math.sqrt(periodsPerYear);
  }

  return {
    strategy_id: strategy?.strategy?.id || 'unknown',
    strategy_name: strategy?.strategy?.name || 'unknown',
    symbol,
    asset,
    period: { start: startTs, end: endTs, candles: ohlcv.length, candleSpanMs },
    start_capital: startCapital,
    end_capital: endNav,
    trades,
    equity_curve: equityCurve,
    decision_log: verbose ? decisionLog : undefined,
    metrics: {
      totalReturn,
      totalReturnPct: totalReturn * 100,
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      maxDrawdown: maxDrawdownPct,           // negative or zero
      maxDrawdownPct: maxDrawdownPct * 100,  // percentage form
      sharpeRatio,
      avgHoldingDays,
      avgHoldingMs,
      periodsPerYear,
    },
    manifest_valid: true,
  };
}

/**
 * Generate a synthetic OHLCV series for offline tests.
 * Trend + sin oscillation + bounded noise. Deterministic given seed.
 */
export function generateSyntheticOHLCV({
  candles = 90,
  startPrice = 2000,
  trendPctPerCandle = 0.001,
  amplitude = 0.04,
  period = 14,
  noisePct = 0.005,
  startTs = Date.UTC(2026, 0, 1),
  candleSpanMs = 86_400_000,
  seed = 1,
} = {}) {
  const out = [];
  let rng = seed;
  const rand = () => {
    // mulberry32
    rng |= 0; rng = (rng + 0x6d2b79f5) | 0;
    let t = Math.imul(rng ^ (rng >>> 15), 1 | rng);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let price = startPrice;
  for (let i = 0; i < candles; i++) {
    const trend = 1 + trendPctPerCandle;
    const oscillator = 1 + amplitude * Math.sin((2 * Math.PI * i) / period);
    const noise = 1 + (rand() - 0.5) * 2 * noisePct;
    const close = price * trend * oscillator * noise;
    const open = price;
    const high = Math.max(open, close) * (1 + Math.abs(rand() - 0.5) * noisePct);
    const low = Math.min(open, close) * (1 - Math.abs(rand() - 0.5) * noisePct);
    const volume = 1_000_000 + rand() * 500_000;
    out.push({
      timestamp: startTs + i * candleSpanMs,
      open, high, low, close, volume,
    });
    price = close;
  }
  return out;
}

/**
 * Fetch historical OHLCV from CoinGecko (free, no API key).
 * symbol → coinGeckoId mapping. Days max 365 free tier.
 */
export async function fetchCoinGeckoOHLCV({ symbol, days = 90 }) {
  const idMap = {
    BTC: 'bitcoin',
    ETH: 'ethereum',
    SOL: 'solana',
    '0G': 'zero-gravity', // best-effort; may not exist
  };
  const id = idMap[symbol?.toUpperCase()];
  if (!id) throw new Error(`Unsupported symbol for CoinGecko: ${symbol}`);
  const url = `https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=${days}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko ${res.status}: ${url}`);
  const arr = await res.json();
  // CoinGecko returns [[ts, open, high, low, close], ...]; volume is not in /ohlc.
  // Synthesize a placeholder volume from price magnitude so downstream math works.
  return arr.map(([ts, open, high, low, close]) => ({
    timestamp: ts,
    open, high, low, close,
    volume: 1_000_000, // placeholder; CG /ohlc lacks volume
  }));
}
