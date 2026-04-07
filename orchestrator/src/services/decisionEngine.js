/**
 * Decision Engine v1 — Full decision matrix implementation.
 *
 * Combines: indicators → regime → scores → veto → action → sizing → intent JSON.
 *
 * Actions: BUY, SELL, REDUCE, HOLD_POSITION, HOLD_FLAT, NO_TRADE
 */

import { computeAllIndicators } from './indicators.js';
import { classifyRegime, regimeSuitability, regimeBias, REGIMES } from './regimeClassifier.js';
import { computeAllScores, computeTradeQualityScore } from './signalScoring.js';
import { evaluateHardVeto, evaluateSoftFilters } from './riskVeto.js';
import logger from '../utils/logger.js';

// ── Hysteresis Thresholds ──
const THRESHOLDS = {
  ENTER_BUY: 72,
  STAY_POSITION: 58,
  REDUCE: 52,
  EXIT: 48,
};

// ── Position Sizing ──
function computePositionSize(confidence, atrPct, rollingDrawdownPct, mandate, maxPositionBps, softPenalty = 0) {
  const baseSizes = { conservative: 700, balanced: 1000, aggressive: 1300 };
  const baseBps = baseSizes[mandate] || 1000;

  // Confidence multiplier
  let confMul = 0.8;
  if (confidence > 0.87) confMul = 1.15;
  else if (confidence > 0.80) confMul = 1.0;

  // Volatility multiplier
  let volMul = 1.0;
  if (atrPct > 3.2) volMul = 0.5;
  else if (atrPct > 2.8) volMul = 0.75;
  else if (atrPct > 2.0) volMul = 0.9;

  // Drawdown multiplier
  let ddMul = 1.0;
  if (rollingDrawdownPct > 6) ddMul = 0.0;
  else if (rollingDrawdownPct > 4) ddMul = 0.6;
  else if (rollingDrawdownPct > 2) ddMul = 0.8;

  // Soft filter penalty
  const softMul = Math.max(0.5, 1.0 - softPenalty);

  let sizeBps = Math.round(baseBps * confMul * volMul * ddMul * softMul);
  sizeBps = Math.max(300, Math.min(sizeBps, maxPositionBps));

  return sizeBps;
}

// ── Reduce fraction based on score ──
function computeReduceFraction(finalEdgeScore) {
  if (finalEdgeScore >= 54) return 2500; // reduce 25%
  if (finalEdgeScore >= 50) return 5000; // reduce 50%
  return 7500; // reduce 75%
}

/**
 * Run the full decision engine.
 *
 * @param {object} params
 * @param {object} params.priceHistory - { prices: number[], volumes: number[], highs?, lows? }
 * @param {number} params.currentPrice - Current asset price
 * @param {number} params.currentVolume - Current volume
 * @param {object} params.vaultState - Extended vault state (see Decision Matrix v1 §4.2)
 * @param {object} params.policy - Extended policy (see Decision Matrix v1 §4.3)
 * @param {object} params.aiView - Optional AI model output { confidence, risk_score, ai_context_score, timing_score }
 * @param {string} params.symbol - Trading pair, e.g. "BTC/USDC"
 * @returns {object} Full v1 JSON decision
 */
export function runDecisionEngine(params) {
  const {
    priceHistory, currentPrice, currentVolume = 0,
    vaultState, policy, aiView = {}, symbol = 'BTC/USDC'
  } = params;

  const now = Math.floor(Date.now() / 1000);

  // ── Step 1: Compute indicators ──
  const indicators = computeAllIndicators(priceHistory, currentPrice, currentVolume);

  // ── Step 2: Classify regime ──
  const regime = classifyRegime(indicators);
  const bias = regimeBias(regime);
  const regimeSuit = regimeSuitability(regime);

  // ── Step 3: Compute scores ──
  const aiContextScore = aiView.ai_context_score ?? 50;
  const scores = computeAllScores(indicators, vaultState, policy, aiContextScore);

  const timingScore = aiView.timing_score ?? 70;
  const tradeQualityScore = computeTradeQualityScore({
    finalEdgeScore: scores.final_edge_score,
    executionScore: scores.liquidity_score,
    timingScore,
    regimeSuitabilityScore: regimeSuit,
    confidenceScaled: (aiView.confidence || 0.5) * 100,
  });

  // ── Step 4: Soft filters ──
  const softFilters = evaluateSoftFilters(indicators, regime);
  const adjustedQuality = tradeQualityScore - softFilters.qualityPenalty;

  // ── Step 5: Hard veto ──
  const veto = evaluateHardVeto(indicators, vaultState, policy, regime, aiView);

  // ── Step 6: Determine action ──
  const confidence = aiView.confidence ?? 0.5;
  const riskScore = aiView.risk_score ?? 0.5;
  const positionSide = vaultState.current_position_side || 'flat';
  const positionPnlPct = vaultState.current_position_pnl_pct || 0;
  const edgeScore = scores.final_edge_score;

  let action, executionMode, entryTrigger, sizeBps, reduceFractionBps;
  let assetIn, assetOut;

  const baseAsset = 'USDC';
  const tradeAsset = symbol.split('/')[0] || 'BTC';

  if (veto.veto) {
    // ── VETO PATH ──
    if (positionSide === 'flat') {
      action = regime === REGIMES.LOW_LIQUIDITY || regime === REGIMES.PANIC_VOLATILE
        ? 'NO_TRADE' : 'HOLD_FLAT';
      executionMode = 'DO_NOT_EXECUTE';
      entryTrigger = 'veto_active';
      sizeBps = 0;
    } else {
      // Has position — check if defensive sell needed
      if (
        positionPnlPct <= -((policy.stop_loss_bps || 220) / 100) ||
        (vaultState.rolling_drawdown_pct || 0) >= 6.0 ||
        indicators.atr_14_pct > 4.2 ||
        confidence < 0.40 ||
        riskScore > 0.55 ||
        regime === REGIMES.TREND_DOWN_STRONG ||
        regime === REGIMES.PANIC_VOLATILE
      ) {
        action = 'SELL';
        executionMode = 'MARKETABLE_SWAP';
        entryTrigger = 'defensive_exit';
        sizeBps = 10000; // full exit
        assetIn = tradeAsset;
        assetOut = baseAsset;
      } else if (edgeScore < THRESHOLDS.REDUCE) {
        action = 'REDUCE';
        executionMode = 'MARKETABLE_SWAP';
        entryTrigger = 'score_deterioration';
        reduceFractionBps = computeReduceFraction(edgeScore);
        sizeBps = reduceFractionBps;
        assetIn = tradeAsset;
        assetOut = baseAsset;
      } else {
        action = 'HOLD_POSITION';
        executionMode = 'DO_NOT_EXECUTE';
        entryTrigger = 'hold_existing';
        sizeBps = 0;
      }
    }
  } else if (positionSide === 'flat') {
    // ── FLAT PATH — check BUY conditions ──
    const buyAllowed =
      [REGIMES.TREND_UP_STRONG, REGIMES.TREND_UP_WEAK, REGIMES.RANGE_STABLE].includes(regime) &&
      edgeScore >= THRESHOLDS.ENTER_BUY &&
      confidence >= (policy.min_confidence_buy || 0.75) &&
      riskScore <= (policy.max_risk_score_buy || 0.28) &&
      adjustedQuality >= 78 &&
      (vaultState.consecutive_losses || 0) <= 1 &&
      indicators.slippage_estimate_bps <= (policy.max_slippage_bps || 30) &&
      indicators.spread_bps <= (policy.max_spread_bps || 20);

    if (buyAllowed) {
      action = 'BUY';
      executionMode = adjustedQuality >= 78 ? 'MARKETABLE_SWAP' : (adjustedQuality >= 70 ? 'WAIT_RETEST' : 'DO_NOT_EXECUTE');
      entryTrigger = indicators.price_vs_vwap_pct > 0 ? 'above_vwap_momentum' : 'dip_to_ema20_bounce';
      const mandate = policy.mandate || (policy.max_position_bps <= 1000 ? 'conservative' : policy.max_position_bps <= 1500 ? 'balanced' : 'aggressive');
      sizeBps = computePositionSize(
        confidence, indicators.atr_14_pct,
        vaultState.rolling_drawdown_pct || 0,
        mandate, policy.max_position_bps || 1500,
        softFilters.sizeMultiplierPenalty
      );
      assetIn = baseAsset;
      assetOut = tradeAsset;
    } else {
      action = (regime === REGIMES.LOW_LIQUIDITY || regime === REGIMES.PANIC_VOLATILE)
        ? 'NO_TRADE' : 'HOLD_FLAT';
      executionMode = 'DO_NOT_EXECUTE';
      entryTrigger = 'none';
      sizeBps = 0;
    }
  } else {
    // ── OPEN POSITION PATH ──
    // Check defensive sell first
    if (
      positionPnlPct <= -((policy.stop_loss_bps || 220) / 100) ||
      (vaultState.rolling_drawdown_pct || 0) >= 6.0 ||
      indicators.atr_14_pct > 4.2 ||
      regime === REGIMES.TREND_DOWN_STRONG ||
      regime === REGIMES.PANIC_VOLATILE
    ) {
      action = 'SELL';
      executionMode = 'MARKETABLE_SWAP';
      entryTrigger = 'defensive_exit';
      sizeBps = 10000;
      assetIn = tradeAsset;
      assetOut = baseAsset;
    }
    // Tactical sell
    else if (edgeScore < THRESHOLDS.EXIT && confidence < 0.55) {
      action = 'SELL';
      executionMode = 'MARKETABLE_SWAP';
      entryTrigger = 'tactical_exit';
      sizeBps = 10000;
      assetIn = tradeAsset;
      assetOut = baseAsset;
    }
    // Profit realization
    else if (positionPnlPct >= 4.5 && edgeScore < THRESHOLDS.STAY_POSITION) {
      action = 'SELL';
      executionMode = 'MARKETABLE_SWAP';
      entryTrigger = 'profit_realization';
      sizeBps = 10000;
      assetIn = tradeAsset;
      assetOut = baseAsset;
    }
    // Reduce
    else if (edgeScore >= THRESHOLDS.EXIT && edgeScore < THRESHOLDS.STAY_POSITION) {
      action = 'REDUCE';
      executionMode = 'MARKETABLE_SWAP';
      entryTrigger = 'score_deterioration';
      reduceFractionBps = computeReduceFraction(edgeScore);
      sizeBps = reduceFractionBps;
      assetIn = tradeAsset;
      assetOut = baseAsset;
    }
    // Partial profit take
    else if (positionPnlPct >= 2.5 && edgeScore < THRESHOLDS.STAY_POSITION) {
      action = 'REDUCE';
      executionMode = 'MARKETABLE_SWAP';
      entryTrigger = 'partial_profit_take';
      reduceFractionBps = 2500;
      sizeBps = 2500;
      assetIn = tradeAsset;
      assetOut = baseAsset;
    }
    // Hold position
    else {
      action = 'HOLD_POSITION';
      executionMode = 'DO_NOT_EXECUTE';
      entryTrigger = 'hold_existing';
      sizeBps = 0;
    }
  }

  // ── Build exit plan ──
  const exitPlan = {
    stop_loss_bps: policy.stop_loss_bps || 220,
    take_profit_bps: policy.take_profit_bps || 450,
    trail_stop_bps: policy.trail_stop_bps || 180,
    reduce_at_score_below: THRESHOLDS.STAY_POSITION,
    full_exit_at_score_below: THRESHOLDS.EXIT,
  };

  // ── Map action to simple category for UI / smart contract ──
  let simpleAction;
  if (action === 'BUY') simpleAction = 'buy';
  else if (action === 'SELL' || action === 'REDUCE') simpleAction = 'sell';
  else simpleAction = 'hold';

  // ── Build reason summary ──
  let reasonSummary;
  if (action === 'BUY') {
    reasonSummary = `${regime} regime with edge score ${edgeScore}, confidence ${(confidence * 100).toFixed(0)}%, risk ${(riskScore * 100).toFixed(0)}%. ${entryTrigger.replace(/_/g, ' ')}.`;
  } else if (action === 'SELL') {
    reasonSummary = `${entryTrigger.replace(/_/g, ' ')} triggered. Regime: ${regime}, edge score ${edgeScore}, confidence ${(confidence * 100).toFixed(0)}%.`;
  } else if (action === 'REDUCE') {
    reasonSummary = `Edge score ${edgeScore} below hold threshold ${THRESHOLDS.STAY_POSITION}. Reducing ${(reduceFractionBps / 100).toFixed(0)}% of position.`;
  } else if (action === 'HOLD_POSITION') {
    reasonSummary = `Position held. Edge score ${edgeScore} >= ${THRESHOLDS.STAY_POSITION}, conditions acceptable.`;
  } else if (action === 'HOLD_FLAT') {
    reasonSummary = `No entry. Edge score ${edgeScore} < ${THRESHOLDS.ENTER_BUY} or conditions not met.${veto.veto ? ' Veto: ' + veto.reasons.join(', ') : ''}`;
  } else {
    reasonSummary = `No trade. ${veto.reasons.join(', ') || regime + ' regime, capital preservation mode.'}`;
  }

  // ── Build full v1 output ──
  const output = {
    version: '1.0',
    timestamp: now,
    symbol,
    regime,
    action,
    simple_action: simpleAction,
    bias,
    confidence,
    risk_score: riskScore,
    ...scores,
    timing_score: timingScore,
    trade_quality_score: adjustedQuality,
    size_bps: sizeBps || 0,
    reduce_fraction_bps: reduceFractionBps || 0,
    execution_mode: executionMode,
    entry_trigger: entryTrigger,
    exit_plan: exitPlan,
    hard_veto: veto.veto,
    hard_veto_reasons: veto.reasons,
    soft_flags: softFilters.flags,
    reason_summary: reasonSummary,
    ttl_sec: 180,
    recommended_asset_in: assetIn || baseAsset,
    recommended_asset_out: assetOut || tradeAsset,
    source: 'decision-engine-v1',
  };

  logger.info(`Decision Engine v1: ${action} ${symbol} | regime=${regime} edge=${edgeScore} conf=${(confidence * 100).toFixed(0)}% risk=${(riskScore * 100).toFixed(0)}% quality=${adjustedQuality} veto=${veto.veto}`);

  return output;
}

/**
 * Convert v1 decision to the simple format used by executor.
 * Maps BUY/SELL/REDUCE → buy/sell, everything else → hold.
 */
export function toSimpleDecision(v1Decision) {
  const sellFractionBps = v1Decision.simple_action === 'sell'
    ? (v1Decision.reduce_fraction_bps || v1Decision.size_bps || 10000)
    : 0;

  return {
    action: v1Decision.simple_action,
    asset: v1Decision.recommended_asset_out === 'USDC' ? v1Decision.recommended_asset_in : v1Decision.recommended_asset_out,
    size_bps: v1Decision.size_bps,
    sell_fraction_bps: sellFractionBps,
    confidence: v1Decision.confidence,
    risk_score: v1Decision.risk_score,
    reason: v1Decision.reason_summary,
    source: v1Decision.source,
    // Extended v1 fields
    regime: v1Decision.regime,
    v1_action: v1Decision.action,
    final_edge_score: v1Decision.final_edge_score,
    trade_quality_score: v1Decision.trade_quality_score,
    hard_veto: v1Decision.hard_veto,
    hard_veto_reasons: v1Decision.hard_veto_reasons,
    entry_trigger: v1Decision.entry_trigger,
  };
}
