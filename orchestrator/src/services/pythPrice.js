import { HermesClient } from '@pythnetwork/hermes-client';
import { ethers } from 'ethers';
import axios from 'axios';
import config from '../config/index.js';
import { getProvider } from '../config/contracts.js';
import { getTrackedAssets, getTokenAddresses } from './assets.js';
import logger from '../utils/logger.js';

/**
 * PythPriceService
 * Fetches real-time prices from Pyth Hermes API and calculates multi-asset NAV.
 * Falls back to on-chain NAVCalculator if Hermes is unavailable.
 */

// ── Pyth Feed IDs ──
const FEED_IDS = {
  BTC: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  ETH: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  USDC: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  '0G': '0xfa9e8d4591613476ad0961732475dc08969d248faca270cc6c47efe009ea3070',
};

// ── Hermes Client ──
const hermes = new HermesClient('https://hermes.pyth.network');

// ── Cache ──
let priceCache = {};
let lastFetch = 0;
const CACHE_TTL = 15_000; // 15 seconds

// Reject Hermes prices whose publish time is older than this. Hermes is
// supposed to be sub-second, so anything past 5 minutes means the upstream
// is degraded and we should fail the cycle rather than size positions on
// stale data. Mirrors `MAX_PRICE_AGE` on VaultNAVCalculator.
const MAX_PRICE_STALENESS_SEC = 300;

/**
 * Fetch latest prices from Pyth Hermes API
 * @returns {{ BTC: number, ETH: number, USDC: number }} Prices in USD
 */
export async function fetchPythPrices() {
  const now = Date.now();
  if (now - lastFetch < CACHE_TTL && Object.keys(priceCache).length > 0) {
    return priceCache;
  }

  try {
    const feedIds = [FEED_IDS.BTC, FEED_IDS.ETH, FEED_IDS.USDC, FEED_IDS['0G']];
    const updates = await hermes.getLatestPriceUpdates(feedIds);

    const prices = {};
    const symbols = ['BTC', 'ETH', 'USDC', '0G'];
    const nowSec = Math.floor(Date.now() / 1000);
    const stale = [];

    for (let i = 0; i < updates.parsed.length; i++) {
      const feed = updates.parsed[i];
      const price = Number(feed.price.price) * Math.pow(10, feed.price.expo);
      const conf = Number(feed.price.conf) * Math.pow(10, feed.price.expo);
      const publishTime = Number(feed.price.publish_time);
      const ageSec = nowSec - publishTime;

      if (Number.isFinite(ageSec) && ageSec > MAX_PRICE_STALENESS_SEC) {
        stale.push(`${symbols[i]} (${ageSec}s)`);
      }

      prices[symbols[i]] = {
        price,
        confidence: conf,
        publishTime,
        ageSec,
        feedId: feed.id,
      };
    }

    if (stale.length > 0) {
      const msg = `Pyth prices stale beyond ${MAX_PRICE_STALENESS_SEC}s: ${stale.join(', ')}`;
      if (config.strictMode) {
        logger.error(`${msg}. Aborting cycle in STRICT_MODE.`);
        throw new Error(`pyth_price_stale: ${stale.join(', ')}`);
      }
      logger.warn(msg);
    }

    priceCache = prices;
    lastFetch = now;
    logger.info(`Pyth prices: BTC=$${prices.BTC?.price.toLocaleString()} ETH=$${prices.ETH?.price.toLocaleString()} 0G=$${prices['0G']?.price.toFixed(4)}`);
    return prices;

  } catch (err) {
    if (config.strictMode) {
      logger.error(`Pyth Hermes fetch failed in STRICT_MODE: ${err.message}. Aborting NAV calculation.`);
      throw new Error(`pyth_oracle_unavailable: ${err.message}`);
    }
    logger.warn(`Pyth Hermes fetch failed: ${err.message}. Using fallback prices.`);
    return getFallbackPrices();
  }
}

/**
 * Fetch historical price candles from Pyth Benchmarks (TradingView-compatible
 * shim). Free, no API key, no rate limiting — runs off Pyth's own oracle
 * historical database. Replaces CoinGecko fetchPriceHistory which gets
 * rate-limited (HTTP 429) under multi-asset multi-cycle load.
 *
 * Returns the same shape as marketData.fetchPriceHistory so buildPriceHistory
 * can consume it without any downstream refactor: `[{timestamp, price}]`.
 *
 * @param {string} assetSymbol - BTC, ETH, USDC, 0G
 * @param {number} days - lookback window in days (default 7)
 * @returns {Promise<Array<{timestamp: number, price: number}>|null>}
 */

// Asset symbol → Pyth Benchmarks symbol.
// Verified via https://benchmarks.pyth.network/v1/shims/tradingview/search
// Native ticker is "Crypto.0G/USD" (literal zero-G, not ZG).
const PYTH_BENCHMARK_SYMBOLS = {
  BTC:  'Crypto.BTC/USD',
  ETH:  'Crypto.ETH/USD',
  USDC: 'Crypto.USDC/USD',
  '0G': 'Crypto.0G/USD',
  ZG:   'Crypto.0G/USD',
};

// In-memory cache so cycles within the TTL window don't re-hit even this free
// endpoint. Benchmarks API is fast but adding a local cache keeps hot-path
// latency predictable.
const PYTH_HISTORY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const pythHistoryCache = new Map();

export async function fetchPriceHistoryFromPyth(assetSymbol, days = 7) {
  const pythSymbol = PYTH_BENCHMARK_SYMBOLS[String(assetSymbol).toUpperCase()];
  if (!pythSymbol) {
    logger.debug(`No Pyth Benchmarks symbol mapping for ${assetSymbol}`);
    return null;
  }

  const cacheKey = `${pythSymbol}:${days}`;
  const cached = pythHistoryCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  // 1h resolution over 7 days = 168 candles. Plenty for RSI/MACD which only
  // need ≥30 data points. 1D resolution gives just 7 points — not enough.
  const resolution = '60';
  const to = Math.floor(now / 1000);
  const from = to - days * 24 * 60 * 60;

  const url = 'https://benchmarks.pyth.network/v1/shims/tradingview/history';
  try {
    const { data } = await axios.get(url, {
      params: { symbol: pythSymbol, resolution, from, to },
      timeout: 10_000,
    });

    if (data?.s !== 'ok' || !Array.isArray(data.t) || !Array.isArray(data.c) || data.t.length === 0) {
      logger.debug(`Pyth Benchmarks returned no data for ${pythSymbol} (status=${data?.s})`);
      // Soft fallback to stale cache if we have one.
      if (cached?.data) return cached.data;
      return null;
    }

    // Shape matches CoinGecko's fetchPriceHistory: [{timestamp (ms), price}].
    // Pyth timestamps come in seconds; convert to ms for consistency.
    const history = data.t.map((ts, i) => ({
      timestamp: ts * 1000,
      price: Number(data.c[i]),
    })).filter((p) => Number.isFinite(p.price) && p.price > 0);

    pythHistoryCache.set(cacheKey, { expiresAt: now + PYTH_HISTORY_CACHE_TTL_MS, data: history });
    return history;
  } catch (err) {
    if (cached?.data) {
      logger.warn(`Pyth Benchmarks fetch failed for ${pythSymbol} (${err.message}); serving stale cache`);
      return cached.data;
    }
    logger.warn(`Pyth Benchmarks fetch failed for ${pythSymbol}: ${err.message}`);
    return null;
  }
}

/**
 * Calculate multi-asset NAV using Pyth prices + on-chain token balances
 * @param {string} vaultAddress - Vault contract address
 * @param {object} tokenAddresses - { usdc, wbtc, weth } contract addresses
 * @returns {{ totalNav: number, breakdown: object[] }}
 */
export async function calculateMultiAssetNAV(vaultAddress, tokenAddresses = null, options = {}) {
  const { priceSnapshot = null } = options;
  const prices = priceSnapshot || await fetchPythPrices();
  const provider = getProvider();

  // ERC20 balanceOf ABI
  const erc20Abi = ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'];
  const defaultTokenAddresses = tokenAddresses || getTokenAddresses();

  const assets = getTrackedAssets().map((asset) => {
    const mappedAddress = defaultTokenAddresses[asset.contractSymbol.toLowerCase()] || asset.address;
    return {
      ...asset,
      address: mappedAddress,
    };
  });

  const breakdown = [];
  let totalNav = 0;

  for (const asset of assets) {
    if (!asset.address) continue;

    try {
      const token = new ethers.Contract(asset.address, erc20Abi, provider);
      const balance = await token.balanceOf(vaultAddress);
      const balanceFormatted = parseFloat(ethers.formatUnits(balance, asset.decimals));

      let valueUsd;
      if (asset.isStablecoin) {
        valueUsd = balanceFormatted * (prices.USDC?.price || 1.0);
      } else {
        const priceData = prices[asset.tradeSymbol];
        valueUsd = balanceFormatted * (priceData?.price || 0);
      }

      breakdown.push({
        symbol: asset.contractSymbol,
        tradeSymbol: asset.tradeSymbol,
        balance: balanceFormatted,
        rawBalance: balance.toString(),
        priceUsd: asset.isStablecoin ? 1.0 : (prices[asset.tradeSymbol]?.price || 0),
        valueUsd,
        pct: 0, // computed after total
      });

      totalNav += valueUsd;
    } catch (err) {
      logger.warn(`Failed to read balance for ${asset.contractSymbol}: ${err.message}`);
      breakdown.push({
        symbol: asset.contractSymbol,
        tradeSymbol: asset.tradeSymbol,
        balance: 0,
        rawBalance: '0',
        priceUsd: 0,
        valueUsd: 0,
        pct: 0,
      });
    }
  }

  // Compute percentages
  for (const item of breakdown) {
    item.pct = totalNav > 0 ? (item.valueUsd / totalNav) * 100 : 0;
  }

  return {
    totalNav,
    breakdown,
    prices: {
      BTC: prices.BTC?.price || 0,
      ETH: prices.ETH?.price || 0,
      USDC: prices.USDC?.price || 1.0,
      '0G': prices['0G']?.price || 0,
    },
    source: 'pyth-hermes',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Calculate NAV using on-chain VaultNAVCalculator (if deployed)
 */
export async function calculateNAVOnChain(navCalculatorAddress, vaultAddress) {
  try {
    const provider = getProvider();
    const navCalc = new ethers.Contract(navCalculatorAddress, [
      'function calculateNAV(address vault) view returns (uint256 navUsd6, uint256[] breakdown)',
    ], provider);

    const [navUsd6, breakdown] = await navCalc.calculateNAV(vaultAddress);
    return {
      totalNav: Number(navUsd6) / 1e6,
      source: 'on-chain-pyth',
    };
  } catch (err) {
    logger.warn(`On-chain NAV calculation failed: ${err.message}`);
    return null;
  }
}

function getFallbackPrices() {
  return {
    BTC: { price: 70000, confidence: 50, publishTime: Math.floor(Date.now() / 1000), feedId: FEED_IDS.BTC },
    ETH: { price: 2200, confidence: 10, publishTime: Math.floor(Date.now() / 1000), feedId: FEED_IDS.ETH },
    USDC: { price: 1.0, confidence: 0.001, publishTime: Math.floor(Date.now() / 1000), feedId: FEED_IDS.USDC },
    '0G': { price: 0.58, confidence: 0.001, publishTime: Math.floor(Date.now() / 1000), feedId: FEED_IDS['0G'] },
  };
}

export { FEED_IDS };
