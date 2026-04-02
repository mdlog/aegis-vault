/**
 * Signal Scoring Engine v1
 * Computes 6 subscores (0-100 each) and a weighted final_edge_score.
 */

function clamp(val, min = 0, max = 100) {
  return Math.min(max, Math.max(min, val));
}

/**
 * Trend Score (0-100)
 * Evaluates EMA alignment and slope direction
 */
export function computeTrendScore(ind) {
  let score = 0;
  if (ind.price > ind.ema_20) score += 30;
  if (ind.ema_20 > ind.ema_50) score += 20;
  if (ind.ema_50 > ind.ema_200) score += 20;
  if (ind.ema_20_slope > 0) score += 15;
  if (ind.ema_50_slope > 0) score += 15;
  return clamp(score);
}

/**
 * Momentum Score (0-100)
 * RSI position, MACD histogram, VWAP relationship
 */
export function computeMomentumScore(ind) {
  let score = 0;
  if (ind.rsi_14 >= 55 && ind.rsi_14 <= 70) score += 25;
  else if (ind.rsi_14 > 70 && ind.rsi_14 <= 80) score += 15;
  if (ind.macd_histogram > 0) score += 20;
  // Check if histogram is increasing (compare to a threshold since we don't have history)
  if (ind.macd_histogram > 10) score += 20;
  if (ind.price_vs_vwap_pct > 0) score += 20;
  return clamp(score);
}

/**
 * Volatility Suitability Score (0-100)
 * Lower volatility = more suitable for trading
 */
export function computeVolatilityScore(ind) {
  const atr = ind.atr_14_pct;
  if (atr <= 2.0) return 100;
  if (atr <= 2.6) return 80;
  if (atr <= 3.2) return 60;
  if (atr <= 3.8) return 35;
  return 10;
}

/**
 * Liquidity / Execution Score (0-100)
 * Evaluates spread, slippage, depth quality
 */
export function computeLiquidityScore(ind) {
  let score = 100;
  score -= 2 * (ind.spread_bps || 0);
  score -= 1.5 * (ind.slippage_estimate_bps || 0);
  // Penalize low volume
  if (ind.volume_zscore < -1) score -= 10;
  return clamp(score);
}

/**
 * Risk State Score (0-100)
 * Evaluates vault's current risk exposure
 */
export function computeRiskStateScore(vaultState, policy) {
  let score = 100;
  score -= 10 * (vaultState.consecutive_losses || 0);
  if (vaultState.daily_pnl_pct < 0) score -= 2 * Math.abs(vaultState.daily_pnl_pct);
  score -= 3 * (vaultState.rolling_drawdown_pct || 0);
  if ((vaultState.actions_last_60m || 0) >= (policy.max_actions_per_60m || 2)) score -= 15;
  if ((vaultState.time_since_last_trade_sec || 9999) < (policy.cooldown_seconds || 900)) score -= 15;
  return clamp(score);
}

/**
 * Compute final edge score with weighted formula
 */
export function computeFinalEdgeScore(scores) {
  return Math.round(
    0.25 * scores.trend +
    0.20 * scores.momentum +
    0.15 * scores.volatility +
    0.15 * scores.liquidity +
    0.15 * scores.riskState +
    0.10 * scores.aiContext
  );
}

/**
 * Compute trade quality score
 */
export function computeTradeQualityScore({ finalEdgeScore, executionScore, timingScore, regimeSuitabilityScore, confidenceScaled }) {
  return Math.round(
    0.30 * finalEdgeScore +
    0.20 * (executionScore || 80) +
    0.20 * (timingScore || 70) +
    0.15 * (regimeSuitabilityScore || 50) +
    0.15 * (confidenceScaled || 50)
  );
}

/**
 * Compute all scores from indicators + vault state + AI context
 * @returns {object} All subscores + final_edge_score + trade_quality_score
 */
export function computeAllScores(indicators, vaultState, policy, aiContextScore = 50) {
  const trend = computeTrendScore(indicators);
  const momentum = computeMomentumScore(indicators);
  const volatility = computeVolatilityScore(indicators);
  const liquidity = computeLiquidityScore(indicators);
  const riskState = computeRiskStateScore(vaultState, policy);

  const scores = { trend, momentum, volatility, liquidity, riskState, aiContext: aiContextScore };
  const finalEdgeScore = computeFinalEdgeScore(scores);

  return {
    trend_score: trend,
    momentum_score: momentum,
    volatility_score: volatility,
    liquidity_score: liquidity,
    risk_state_score: riskState,
    ai_context_score: aiContextScore,
    final_edge_score: finalEdgeScore,
  };
}
