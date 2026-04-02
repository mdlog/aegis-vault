/**
 * Regime Classification Engine v1
 * Classifies market into one of 8 regimes based on technical indicators.
 * Priority order ensures dangerous regimes override bullish ones.
 */

export const REGIMES = {
  LOW_LIQUIDITY: 'LOW_LIQUIDITY',
  PANIC_VOLATILE: 'PANIC_VOLATILE',
  TREND_UP_STRONG: 'TREND_UP_STRONG',
  TREND_DOWN_STRONG: 'TREND_DOWN_STRONG',
  TREND_UP_WEAK: 'TREND_UP_WEAK',
  TREND_DOWN_WEAK: 'TREND_DOWN_WEAK',
  RANGE_NOISY: 'RANGE_NOISY',
  RANGE_STABLE: 'RANGE_STABLE',
};

/**
 * Classify market regime from indicators
 * @param {object} ind - indicators from computeAllIndicators()
 * @returns {string} One of REGIMES values
 */
export function classifyRegime(ind) {
  // Priority 1: LOW_LIQUIDITY
  if (ind.spread_bps > 20 || ind.slippage_estimate_bps > 30) {
    return REGIMES.LOW_LIQUIDITY;
  }

  // Priority 2: PANIC_VOLATILE
  if (ind.atr_14_pct > 3.8 || ind.realized_vol_1h_pct > 4.2) {
    return REGIMES.PANIC_VOLATILE;
  }

  // Priority 3: TREND_UP_STRONG
  if (
    ind.price > ind.ema_20 &&
    ind.ema_20 > ind.ema_50 &&
    ind.ema_50 > ind.ema_200 &&
    ind.rsi_14 >= 58 && ind.rsi_14 <= 74 &&
    ind.macd_histogram > 0 &&
    ind.atr_14_pct <= 2.8 &&
    ind.mtf_alignment === 'bullish'
  ) {
    return REGIMES.TREND_UP_STRONG;
  }

  // Priority 4: TREND_DOWN_STRONG
  if (
    ind.price < ind.ema_20 &&
    ind.ema_20 < ind.ema_50 &&
    ind.ema_50 < ind.ema_200 &&
    ind.rsi_14 >= 20 && ind.rsi_14 <= 42 &&
    ind.macd_histogram < 0 &&
    ind.atr_14_pct <= 3.0 &&
    ind.mtf_alignment === 'bearish'
  ) {
    return REGIMES.TREND_DOWN_STRONG;
  }

  // Priority 5: TREND_UP_WEAK
  if (
    ind.price > ind.ema_20 &&
    ind.ema_20 > ind.ema_50 &&
    ind.ema_50 >= ind.ema_200 &&
    ind.rsi_14 >= 52 && ind.rsi_14 <= 65 &&
    ind.macd_histogram >= 0 &&
    ind.atr_14_pct <= 3.2
  ) {
    return REGIMES.TREND_UP_WEAK;
  }

  // Priority 6: TREND_DOWN_WEAK
  if (
    ind.price < ind.ema_20 &&
    ind.ema_20 < ind.ema_50 &&
    ind.ema_50 <= ind.ema_200 &&
    ind.rsi_14 >= 35 && ind.rsi_14 <= 48 &&
    ind.macd_histogram <= 0
  ) {
    return REGIMES.TREND_DOWN_WEAK;
  }

  // Priority 7: RANGE_NOISY
  if (
    ind.rsi_14 >= 40 && ind.rsi_14 <= 60 &&
    ind.atr_14_pct > 2.0 && ind.atr_14_pct <= 3.8 &&
    ind.mtf_alignment === 'mixed'
  ) {
    return REGIMES.RANGE_NOISY;
  }

  // Priority 8: RANGE_STABLE
  const distFromEma50 = ind.ema_50 > 0 ? Math.abs(ind.price - ind.ema_50) / ind.ema_50 : 0;
  if (
    distFromEma50 <= 0.015 &&
    ind.rsi_14 >= 42 && ind.rsi_14 <= 58 &&
    ind.atr_14_pct <= 2.0
  ) {
    return REGIMES.RANGE_STABLE;
  }

  // Default fallback
  return REGIMES.RANGE_NOISY;
}

/**
 * Get regime suitability score for trading (0-100)
 */
export function regimeSuitability(regime) {
  const scores = {
    [REGIMES.TREND_UP_STRONG]: 95,
    [REGIMES.TREND_UP_WEAK]: 70,
    [REGIMES.RANGE_STABLE]: 55,
    [REGIMES.RANGE_NOISY]: 30,
    [REGIMES.TREND_DOWN_WEAK]: 25,
    [REGIMES.TREND_DOWN_STRONG]: 15,
    [REGIMES.PANIC_VOLATILE]: 5,
    [REGIMES.LOW_LIQUIDITY]: 5,
  };
  return scores[regime] ?? 30;
}

/**
 * Get regime bias
 */
export function regimeBias(regime) {
  if (regime.includes('UP')) return 'BULLISH';
  if (regime.includes('DOWN') || regime === REGIMES.PANIC_VOLATILE) return 'BEARISH';
  return 'NEUTRAL';
}
