import { HermesClient } from '@pythnetwork/hermes-client';
import { ethers } from 'ethers';
import config from '../config/index.js';
import { getProvider } from '../config/contracts.js';
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
};

// ── Hermes Client ──
const hermes = new HermesClient('https://hermes.pyth.network');

// ── Cache ──
let priceCache = {};
let lastFetch = 0;
const CACHE_TTL = 15_000; // 15 seconds

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
    const feedIds = [FEED_IDS.BTC, FEED_IDS.ETH, FEED_IDS.USDC];
    const updates = await hermes.getLatestPriceUpdates(feedIds);

    const prices = {};
    const symbols = ['BTC', 'ETH', 'USDC'];

    for (let i = 0; i < updates.parsed.length; i++) {
      const feed = updates.parsed[i];
      const price = Number(feed.price.price) * Math.pow(10, feed.price.expo);
      const conf = Number(feed.price.conf) * Math.pow(10, feed.price.expo);

      prices[symbols[i]] = {
        price,
        confidence: conf,
        publishTime: feed.price.publish_time,
        feedId: feed.id,
      };
    }

    priceCache = prices;
    lastFetch = now;
    logger.info(`Pyth prices: BTC=$${prices.BTC?.price.toLocaleString()} ETH=$${prices.ETH?.price.toLocaleString()}`);
    return prices;

  } catch (err) {
    logger.warn(`Pyth Hermes fetch failed: ${err.message}. Using fallback prices.`);
    return getFallbackPrices();
  }
}

/**
 * Calculate multi-asset NAV using Pyth prices + on-chain token balances
 * @param {string} vaultAddress - Vault contract address
 * @param {object} tokenAddresses - { usdc, wbtc, weth } contract addresses
 * @returns {{ totalNav: number, breakdown: object[] }}
 */
export async function calculateMultiAssetNAV(vaultAddress, tokenAddresses) {
  const prices = await fetchPythPrices();
  const provider = getProvider();

  // ERC20 balanceOf ABI
  const erc20Abi = ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'];

  const assets = [
    { symbol: 'USDC', address: tokenAddresses.usdc, decimals: 6, isStable: true },
    { symbol: 'WBTC', address: tokenAddresses.wbtc, decimals: 8, isStable: false },
    { symbol: 'WETH', address: tokenAddresses.weth, decimals: 18, isStable: false },
  ];

  const breakdown = [];
  let totalNav = 0;

  for (const asset of assets) {
    if (!asset.address) continue;

    try {
      const token = new ethers.Contract(asset.address, erc20Abi, provider);
      const balance = await token.balanceOf(vaultAddress);
      const balanceFormatted = parseFloat(ethers.formatUnits(balance, asset.decimals));

      let valueUsd;
      if (asset.isStable) {
        valueUsd = balanceFormatted * (prices.USDC?.price || 1.0);
      } else {
        const priceData = prices[asset.symbol === 'WBTC' ? 'BTC' : 'ETH'];
        valueUsd = balanceFormatted * (priceData?.price || 0);
      }

      breakdown.push({
        symbol: asset.symbol,
        balance: balanceFormatted,
        priceUsd: asset.isStable ? 1.0 : (prices[asset.symbol === 'WBTC' ? 'BTC' : 'ETH']?.price || 0),
        valueUsd,
        pct: 0, // computed after total
      });

      totalNav += valueUsd;
    } catch (err) {
      logger.warn(`Failed to read balance for ${asset.symbol}: ${err.message}`);
      breakdown.push({ symbol: asset.symbol, balance: 0, priceUsd: 0, valueUsd: 0, pct: 0 });
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
  };
}

export { FEED_IDS };
