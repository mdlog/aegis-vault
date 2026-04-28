/**
 * Hard Veto Layer + Soft Filters v1
 *
 * Hard veto: if ANY condition is true, BUY is forbidden.
 * Soft filters: degrade trade quality but don't block outright.
 */

import { REGIMES } from './regimeClassifier.js';

/**
 * Evaluate hard veto conditions.
 *
 * Threshold resolution priority (most specific wins):
 *   1. strategy.veto.* (operator manifest, V4 multi-strategy)
 *   2. policy.* (vault policy, set at create)
 *   3. Hardcoded defaults
 *
 * Strategy can only be MORE conservative than vault policy (the policy is a
 * hard ceiling). Strategy values that exceed vault policy get clamped to
 * the policy ceiling — never the other way around.
 *
 * @param {object} indicators
 * @param {object} vaultState
 * @param {object} policy
 * @param {string} regime
 * @param {object} aiView
 * @param {object|null} strategy  — V4 strategy manifest (optional)
 * @returns {{ veto: boolean, reasons: string[] }}
 */
export function evaluateHardVeto(indicators, vaultState, policy, regime, aiView, strategy = null) {
  const reasons = [];
  const sv = strategy?.veto || {};

  // 1. Vault paused
  if (policy.pause) reasons.push('vault_paused');

  // 2. Asset not in whitelist (only check for buy/sell, not hold)
  if (aiView?.asset && aiView.asset !== 'USDC' && policy.allowed_assets && !policy.allowed_assets.includes(aiView.asset)) {
    reasons.push('asset_not_whitelisted');
  }

  // 3. Open intents pending
  if ((vaultState.open_intents || 0) > 0) reasons.push('open_intents_pending');

  // 4. Cooldown not elapsed
  if ((vaultState.time_since_last_trade_sec || 9999) < (policy.cooldown_seconds || 900)) {
    reasons.push('cooldown_active');
  }

  // 5. Too many actions in 60m
  if ((vaultState.actions_last_60m || 0) >= (policy.max_actions_per_60m || 2)) {
    reasons.push('max_actions_60m_reached');
  }

  // 6. Daily loss limit breached
  const maxDailyLossPct = (policy.max_daily_loss_bps || 300) / 100;
  if ((vaultState.daily_pnl_pct || 0) <= -maxDailyLossPct) {
    reasons.push('daily_loss_limit_breached');
  }

  // 7. Rolling drawdown too deep
  if ((vaultState.rolling_drawdown_pct || 0) >= 6.0) {
    reasons.push('rolling_drawdown_exceeded');
  }

  // 8. Too many consecutive losses
  // Strategy override wins when set — operator commits to whatever bound they
  // declared in the manifest. Falls back to default (3) when unspecified.
  const maxLosses = sv.maxConsecutiveLosses ?? 3;
  if ((vaultState.consecutive_losses || 0) >= maxLosses) {
    reasons.push('consecutive_losses_exceeded');
  }

  // 9. Spread too wide. Vault policy ceiling preserved (HARD limit). Strategy
  // can tighten by passing a smaller value via sv.maxSpreadBps.
  const maxSpread = sv.maxSpreadBps != null
    ? Math.min(sv.maxSpreadBps, policy.max_spread_bps ?? 20)
    : (policy.max_spread_bps ?? 20);
  if ((indicators.spread_bps || 0) > maxSpread) {
    reasons.push('spread_too_wide');
  }

  // 10. Slippage too high. Same intersection rule as spread.
  const maxSlippage = sv.maxSlippageBps != null
    ? Math.min(sv.maxSlippageBps, policy.max_slippage_bps ?? 30)
    : (policy.max_slippage_bps ?? 30);
  if ((indicators.slippage_estimate_bps || 0) > maxSlippage) {
    reasons.push('slippage_too_high');
  }

  // 11. Extreme volatility. Strategy override wins (operator's commitment).
  // No hardcoded ceiling because volatility tolerance is fundamentally a
  // strategy choice (mean-reversion wants low ATR; momentum tolerates higher).
  // Default 3.8 only applies when strategy doesn't declare.
  // Period-aware: prefer `atr_pct` (strategy-configured period) over `atr_14_pct`
  // when the strategy customised atr.period — otherwise both are equal.
  const maxAtrPct = sv.maxAtrPct ?? 3.8;
  const atrValue = indicators.atr_pct ?? indicators.atr_14_pct ?? 0;
  if (atrValue > maxAtrPct) {
    reasons.push('extreme_volatility');
  }

  // 11b. Strategy-specific RSI veto (overbought / oversold knockout)
  // Period-aware: prefer strategy-configured `rsi` over fixed-14 `rsi_14`
  // when present.
  const rsiValue = indicators.rsi ?? indicators.rsi_14 ?? 50;
  if (sv.rsiOverbought != null && rsiValue > sv.rsiOverbought) {
    reasons.push('rsi_overbought_strategy_veto');
  }
  if (sv.rsiOversold != null && rsiValue < sv.rsiOversold) {
    reasons.push('rsi_oversold_strategy_veto');
  }

  // 12. Market data stale (check if timestamp is old)
  // Handled by caller — if market data fetch failed, orchestrator should flag this

  // 13. Route / venue degraded — simplified check
  if (regime === REGIMES.LOW_LIQUIDITY) {
    reasons.push('venue_degraded');
  }

  // 14. AI confidence too low for buy
  //
  // Uses the policy-derived reduce/sell threshold (set by buildV1Policy from
  // vault.confidenceThresholdBps). Previously hardcoded at 0.55, which
  // overrode user-configured vault policy and made any vault with a lower
  // confidence threshold silently unable to execute.
  const confidence = aiView?.confidence || 0;
  const minConfidence = policy.min_confidence_reduce_or_sell ?? 0.55;
  if (confidence < minConfidence) {
    reasons.push('confidence_below_minimum');
  }

  // 15. Risk score too high for buy
  //
  // Also scaled from vault policy — a vault with a low confidence threshold
  // has implicitly opted into higher risk tolerance, so the engine's risk
  // veto scales inversely (set by buildV1Policy).
  const riskScore = aiView?.risk_score || 0.5;
  const maxRisk = policy.max_risk_score_buy ?? 0.45;
  if (riskScore > maxRisk) {
    reasons.push('risk_score_too_high');
  }

  return {
    veto: reasons.length > 0,
    reasons,
  };
}

/**
 * Evaluate soft filters that degrade trade quality.
 * @returns {{ active: number, flags: string[], qualityPenalty: number, sizeMultiplierPenalty: number }}
 */
export function evaluateSoftFilters(indicators, regime) {
  const flags = [];

  // Near resistance for long entry
  if ((indicators.distance_to_local_resistance_pct || 5) < 1.2) {
    flags.push('near_minor_resistance');
  }

  // RSI overbought
  if ((indicators.rsi_14 || 50) > 72) {
    flags.push('rsi_overbought');
  }

  // Price extended above VWAP
  if ((indicators.price_vs_vwap_pct || 0) > 1.5) {
    flags.push('extended_above_vwap');
  }

  // Volume doesn't support breakout
  if ((indicators.volume_zscore || 0) < 0.5 && regime?.includes('TREND_UP')) {
    flags.push('volume_not_supporting');
  }

  // MTF mixed
  if (indicators.mtf_alignment === 'mixed') {
    flags.push('mtf_alignment_mixed');
  }

  // Spike without retest
  if ((indicators.price_vs_vwap_pct || 0) > 2.0 && (indicators.rsi_14 || 50) > 68) {
    flags.push('spike_without_retest');
  }

  const activeCount = flags.length;
  const qualityPenalty = activeCount >= 2 ? 10 : 0;
  const sizeMultiplierPenalty = activeCount >= 2 ? 0.15 : 0;

  return {
    active: activeCount,
    flags,
    qualityPenalty,
    sizeMultiplierPenalty,
  };
}
