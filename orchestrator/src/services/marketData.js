import axios from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * MarketDataService
 * Fetches real market data from CoinGecko for AI inference input.
 * Falls back to simulated data if API fails (for hackathon resilience).
 */

// In-memory cache to avoid rate limits
let cache = {};
let lastFetch = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

/**
 * Fetch current prices, 24h change, and basic market data
 */
export async function fetchMarketData() {
  const now = Date.now();
  if (now - lastFetch < CACHE_TTL_MS && Object.keys(cache).length > 0) {
    logger.debug('Using cached market data');
    return cache;
  }

  try {
    const ids = Object.values(config.assets).map(a => a.coingeckoId).join(',');
    const url = `${config.coingeckoUrl}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`;

    const { data } = await axios.get(url, { timeout: 10_000 });

    const result = {};
    for (const [symbol, meta] of Object.entries(config.assets)) {
      const coinData = data[meta.coingeckoId];
      if (coinData) {
        result[symbol] = {
          symbol,
          price: coinData.usd,
          change24h: coinData.usd_24h_change || 0,
          volume24h: coinData.usd_24h_vol || 0,
          marketCap: coinData.usd_market_cap || 0,
          timestamp: now,
        };
      }
    }

    cache = result;
    lastFetch = now;
    logger.info(`Market data fetched: ${Object.keys(result).join(', ')}`);
    return result;

  } catch (err) {
    if (config.strictMode) {
      logger.error(`CoinGecko fetch failed in STRICT_MODE: ${err.message}. Aborting cycle.`);
      throw new Error(`market_data_unavailable: ${err.message}`);
    }
    logger.warn(`CoinGecko fetch failed: ${err.message}. Using fallback data.`);
    return getFallbackData();
  }
}

/**
 * Fetch historical price data for volatility calculation
 */
export async function fetchPriceHistory(coingeckoId, days = 7) {
  try {
    const url = `${config.coingeckoUrl}/coins/${coingeckoId}/market_chart?vs_currency=usd&days=${days}`;
    const { data } = await axios.get(url, { timeout: 10_000 });
    return data.prices.map(([ts, price]) => ({ timestamp: ts, price }));
  } catch (err) {
    logger.warn(`Price history fetch failed for ${coingeckoId}: ${err.message}`);
    return null;
  }
}

/**
 * Calculate simple volatility from price history
 */
export function calculateVolatility(priceHistory) {
  if (!priceHistory || priceHistory.length < 2) return null;

  const returns = [];
  for (let i = 1; i < priceHistory.length; i++) {
    const ret = (priceHistory[i].price - priceHistory[i - 1].price) / priceHistory[i - 1].price;
    returns.push(ret);
  }

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(365); // Annualized
}

/**
 * Build a market summary object for the AI prompt
 */
export async function buildMarketSummary() {
  const prices = await fetchMarketData();

  // Try to get BTC volatility
  let btcVolatility = null;
  const btcHistory = await fetchPriceHistory('bitcoin', 7);
  if (btcHistory) {
    btcVolatility = calculateVolatility(btcHistory);
  }

  let ethVolatility = null;
  const ethHistory = await fetchPriceHistory('ethereum', 7);
  if (ethHistory) {
    ethVolatility = calculateVolatility(ethHistory);
  }

  return {
    timestamp: Date.now(),
    prices,
    volatility: {
      BTC: btcVolatility ? (btcVolatility * 100).toFixed(2) + '%' : 'unavailable',
      ETH: ethVolatility ? (ethVolatility * 100).toFixed(2) + '%' : 'unavailable',
    },
    summary: Object.entries(prices).map(([sym, d]) => {
      const dir = d.change24h > 0 ? '↑' : d.change24h < 0 ? '↓' : '→';
      return `${sym}: $${d.price.toLocaleString()} (${dir} ${d.change24h.toFixed(2)}% 24h)`;
    }).join(' | '),
  };
}

/**
 * Fallback data for when CoinGecko is unavailable
 */
function getFallbackData() {
  const now = Date.now();
  return {
    BTC: { symbol: 'BTC', price: 69500, change24h: 1.2, volume24h: 28_000_000_000, marketCap: 1_370_000_000_000, timestamp: now },
    ETH: { symbol: 'ETH', price: 2200, change24h: -0.8, volume24h: 12_000_000_000, marketCap: 265_000_000_000, timestamp: now },
    USDC: { symbol: 'USDC', price: 1.0, change24h: 0.0, volume24h: 5_000_000_000, marketCap: 33_000_000_000, timestamp: now },
  };
}
