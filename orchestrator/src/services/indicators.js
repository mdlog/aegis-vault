/**
 * Technical Indicators Service
 * Computes EMA, RSI, MACD, ATR, VWAP proxies, and volume z-score
 * from price history data (CoinGecko hourly/daily candles).
 */

/**
 * Exponential Moving Average
 */
export function computeEMA(prices, period) {
  if (!prices || prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((s, p) => s + p, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

/**
 * Compute EMA slope (positive = trending up)
 */
export function computeEMASlope(prices, period, lookback = 5) {
  if (!prices || prices.length < period + lookback) return 0;
  const recent = prices.slice(-lookback - period);
  const emaNow = computeEMA(prices, period);
  const emaPrev = computeEMA(recent.slice(0, -lookback), period);
  if (!emaNow || !emaPrev || emaPrev === 0) return 0;
  return (emaNow - emaPrev) / emaPrev;
}

/**
 * Relative Strength Index (14-period)
 */
export function computeRSI(prices, period = 14) {
  if (!prices || prices.length < period + 1) return 50; // neutral default

  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * MACD Histogram (12, 26, 9)
 */
export function computeMACD(prices) {
  if (!prices || prices.length < 26) return { histogram: 0, macdLine: 0, signalLine: 0 };

  const ema12 = computeEMA(prices, 12);
  const ema26 = computeEMA(prices, 26);
  const macdLine = ema12 - ema26;

  // Simplified signal line — compute MACD values then EMA of those
  const macdValues = [];
  for (let i = 26; i <= prices.length; i++) {
    const e12 = computeEMA(prices.slice(0, i), 12);
    const e26 = computeEMA(prices.slice(0, i), 26);
    macdValues.push(e12 - e26);
  }
  const signalLine = macdValues.length >= 9 ? computeEMA(macdValues, 9) : macdLine;

  return {
    histogram: macdLine - signalLine,
    macdLine,
    signalLine,
  };
}

/**
 * Average True Range as percentage of price (14-period)
 */
export function computeATR(highs, lows, closes, period = 14) {
  if (!highs || highs.length < period + 1) {
    // Fallback: estimate from price changes
    if (closes && closes.length >= period) {
      let sumRange = 0;
      for (let i = closes.length - period; i < closes.length; i++) {
        sumRange += Math.abs(closes[i] - closes[i - 1]);
      }
      const atr = sumRange / period;
      const lastPrice = closes[closes.length - 1];
      return lastPrice > 0 ? (atr / lastPrice) * 100 : 0;
    }
    return 2.0; // default moderate
  }

  let atr = 0;
  for (let i = highs.length - period; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    atr += tr;
  }
  atr /= period;
  const lastPrice = closes[closes.length - 1];
  return lastPrice > 0 ? (atr / lastPrice) * 100 : 0;
}

/**
 * Realized volatility (1h) as percentage — from recent price array
 */
export function computeRealizedVol(prices, window = 24) {
  if (!prices || prices.length < window + 1) return 2.0;
  const returns = [];
  const slice = prices.slice(-window - 1);
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1] > 0) returns.push((slice[i] - slice[i - 1]) / slice[i - 1]);
  }
  if (returns.length === 0) return 2.0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100; // as percentage per period
}

/**
 * Volume z-score (how unusual is current volume vs recent average)
 */
export function computeVolumeZScore(volumes, current) {
  if (!volumes || volumes.length < 5) return 0;
  const mean = volumes.reduce((s, v) => s + v, 0) / volumes.length;
  const variance = volumes.reduce((s, v) => s + (v - mean) ** 2, 0) / volumes.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (current - mean) / std;
}

/**
 * Price vs VWAP proxy (percentage above/below)
 * Uses volume-weighted average of recent prices as VWAP proxy
 */
export function computePriceVsVWAP(prices, volumes, currentPrice) {
  if (!prices || !volumes || prices.length < 5) return 0;
  let totalPV = 0, totalV = 0;
  for (let i = 0; i < prices.length; i++) {
    totalPV += prices[i] * (volumes[i] || 1);
    totalV += (volumes[i] || 1);
  }
  const vwap = totalV > 0 ? totalPV / totalV : currentPrice;
  return vwap > 0 ? ((currentPrice - vwap) / vwap) * 100 : 0;
}

/**
 * Multi-timeframe alignment
 * Returns 'bullish', 'bearish', or 'mixed'
 */
export function computeMTFAlignment(prices) {
  if (!prices || prices.length < 200) return 'mixed';
  const ema20 = computeEMA(prices, 20);
  const ema50 = computeEMA(prices, 50);
  const ema200 = computeEMA(prices, 200);
  const price = prices[prices.length - 1];

  if (price > ema20 && ema20 > ema50 && ema50 > ema200) return 'bullish';
  if (price < ema20 && ema20 < ema50 && ema50 < ema200) return 'bearish';
  return 'mixed';
}

/**
 * Compute all indicators for a symbol from price history
 * @param {object} data - { prices: number[], volumes: number[], highs?: number[], lows?: number[] }
 * @param {number} currentPrice
 * @param {number} currentVolume
 * @returns {object} Full indicator set
 */
export function computeAllIndicators(data, currentPrice, currentVolume = 0) {
  const { prices = [], volumes = [], highs, lows } = data;
  const closes = prices;

  const ema20 = computeEMA(closes, 20) || currentPrice;
  const ema50 = computeEMA(closes, 50) || currentPrice;
  const ema200 = computeEMA(closes, 200) || currentPrice;
  const rsi14 = computeRSI(closes, 14);
  const macd = computeMACD(closes);
  const atr14Pct = computeATR(highs, lows, closes, 14);
  const realizedVol1hPct = computeRealizedVol(closes, 24);
  const volumeZScore = computeVolumeZScore(volumes, currentVolume);
  const priceVsVwapPct = computePriceVsVWAP(closes.slice(-50), volumes.slice(-50), currentPrice);
  const mtfAlignment = computeMTFAlignment(closes);
  const ema20Slope = computeEMASlope(closes, 20);
  const ema50Slope = computeEMASlope(closes, 50);

  return {
    price: currentPrice,
    ema_20: ema20,
    ema_50: ema50,
    ema_200: ema200,
    ema_20_slope: ema20Slope,
    ema_50_slope: ema50Slope,
    rsi_14: rsi14,
    macd_histogram: macd.histogram,
    macd_line: macd.macdLine,
    macd_signal: macd.signalLine,
    atr_14_pct: atr14Pct,
    realized_vol_1h_pct: realizedVol1hPct,
    volume_zscore: volumeZScore,
    price_vs_vwap_pct: priceVsVwapPct,
    mtf_alignment: mtfAlignment,
    // Placeholders — would need order book data for real values
    spread_bps: 8,
    slippage_estimate_bps: 15,
    distance_to_local_resistance_pct: 2.0,
    distance_to_local_support_pct: 3.0,
  };
}
