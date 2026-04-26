/**
 * quoteRouter — pick the best venue for a single swap leg.
 *
 * The orchestrator currently routes every swap directly through Jaine on 0G.
 * Khalani / HyperStream is a multi-chain intent settlement protocol whose
 * solver network sometimes returns better effective rates *even for
 * same-chain swaps* (it can route through a cross-chain solver if that
 * yields a higher post-fee output). This module fetches both quotes in
 * parallel and returns the winner so the executor can select the source of
 * truth for slippage calculations.
 *
 * Phase 2 scope: pure quoting comparison. The winner's `amountOut` is
 * surfaced for `minAmountOut` derivation, but actual execution still goes
 * through the Jaine adapter — Khalani submission is wired in Phase 3 once
 * the V3 vault contract supports the deposit/build/submit flow.
 *
 * Tunables (env):
 *   QUOTE_KHALANI_PREFERENCE_BPS  — bps Khalani must beat Jaine by to win.
 *                                   Default 10 (0.1%) builds in a small
 *                                   penalty for Khalani's slower settlement
 *                                   (1–3 minutes vs single-block on-chain).
 */

import { ethers } from 'ethers';
import { getProvider } from '../config/contracts.js';
import { fetchQuote as khalaniFetchQuote } from './khalani.js';
import logger from '../utils/logger.js';

const VENUE_QUOTE_ABI = [
  'function getAmountOut(address,address,uint256) view returns (uint256)',
];

const DEFAULT_PREFERENCE_BPS = 10;
const DEFAULT_CHAIN_ID = 16661; // 0G Mainnet

/**
 * Direct on-chain quote against a Jaine adapter (or any venue exposing the
 * same `getAmountOut(tokenIn, tokenOut, amountIn)` view).
 *
 * Returns `null` on any failure (zero address, RPC error, missing pair). The
 * caller is expected to fall back to oracle-derived floors in that case.
 */
export async function quoteVenueAmountOut(venue, tokenIn, tokenOut, amountIn) {
  if (!venue || venue === ethers.ZeroAddress) return null;
  try {
    const c = new ethers.Contract(venue, VENUE_QUOTE_ABI, getProvider());
    const out = await c.getAmountOut(tokenIn, tokenOut, amountIn);
    return BigInt(out);
  } catch (err) {
    logger.warn(`  Venue quote failed (${venue}): ${err.shortMessage || err.message}`);
    return null;
  }
}

/**
 * Parse the configured Khalani preference threshold. Accepts negative values
 * (force Khalani to win even when slightly worse) but clamps NaN/empty to the
 * default so a misconfigured env never silently disables the comparator.
 */
function readPreferenceBps(override) {
  if (Number.isFinite(override)) return Number(override);
  const raw = process.env.QUOTE_KHALANI_PREFERENCE_BPS;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_PREFERENCE_BPS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_PREFERENCE_BPS;
}

/**
 * Compute (khalani - jaine) / jaine in basis points. Negative means Jaine
 * is the bigger output. Returns 0 when jaine is zero (avoids div-by-zero in
 * "khalani-only succeeded" paths where the comparison is moot anyway).
 */
function diffBpsFor(jaineOut, khalaniOut) {
  if (!jaineOut || jaineOut === 0n) return 0;
  // Use BigInt math for the subtraction to preserve precision, then cast to
  // Number for the divide — the result fits comfortably in a JS number since
  // bps differences are bounded (±10000 covers ±100%).
  const delta = khalaniOut - jaineOut;
  // Multiply by 10000 *before* the divide to keep one bps of resolution.
  const scaled = (delta * 10000n) / jaineOut;
  return Number(scaled);
}

/**
 * Compare a Jaine direct quote vs a Khalani route, return the winner.
 *
 * Both quotes are fetched in parallel via `Promise.allSettled` so a Khalani
 * outage never blocks the on-chain path (and vice versa). All four outcomes
 * (both succeed, only-jaine, only-khalani, both fail) produce a structured
 * result with a human-readable rationale the caller can drop into a log.
 *
 * @param {Object} params
 * @param {string} params.venue
 * @param {string} params.tokenIn
 * @param {string} params.tokenOut
 * @param {bigint|string} params.amountIn
 * @param {string} params.executorAddress
 * @param {number} [params.chainId=16661]
 * @param {number} [params.preferenceBps]
 * @returns {Promise<object>}
 */
export async function chooseRoute(params) {
  const {
    venue,
    tokenIn,
    tokenOut,
    amountIn,
    executorAddress,
    chainId = DEFAULT_CHAIN_ID,
    // _deps is a test seam for unit tests — production callers never pass it.
    // Lets us substitute the venue quoter and Khalani client without poking at
    // ESM live bindings (which are read-only and can't be monkey-patched).
    _deps,
  } = params || {};

  const venueQuoter = _deps?.quoteVenueAmountOut || quoteVenueAmountOut;
  const khalaniQuoter = _deps?.khalaniFetchQuote || khalaniFetchQuote;

  const preferenceBps = readPreferenceBps(params?.preferenceBps);
  const amountInBig = typeof amountIn === 'bigint' ? amountIn : BigInt(amountIn);

  // Both legs run concurrently. allSettled means a Khalani 5xx or a stalled
  // RPC on Jaine can't poison the other branch.
  const [jaineSettled, khalaniSettled] = await Promise.allSettled([
    venueQuoter(venue, tokenIn, tokenOut, amountInBig),
    khalaniQuoter({
      fromAddress: executorAddress,
      fromChainId: chainId,
      fromToken: tokenIn,
      toChainId: chainId,
      toToken: tokenOut,
      amount: amountInBig.toString(),
      tradeType: 'EXACT_INPUT',
    }),
  ]).then((results) => results);

  const jaineQuote = jaineSettled.status === 'fulfilled' && jaineSettled.value && jaineSettled.value > 0n
    ? jaineSettled.value
    : null;

  let khalaniQuote = null;
  let khalaniRoute = null;
  let khalaniQuoteId;
  if (khalaniSettled.status === 'fulfilled') {
    const resp = khalaniSettled.value;
    const route0 = resp?.routes?.[0];
    const rawOut = route0?.quote?.amountOut;
    if (rawOut !== undefined && rawOut !== null) {
      try {
        const parsed = BigInt(rawOut);
        if (parsed > 0n) {
          khalaniQuote = parsed;
          khalaniRoute = route0;
          khalaniQuoteId = resp.quoteId;
        }
      } catch (_) {
        // Malformed amountOut — treat as Khalani failure.
      }
    }
  } else {
    // Surface the upstream error to logs (debug level — chooseRoute callers
    // already log the rationale at info level, no need to double up).
    logger.debug(`  Khalani quote failed: ${khalaniSettled.reason?.shortMessage || khalaniSettled.reason?.message || khalaniSettled.reason}`);
  }

  // Outcome 1: both failed. Caller falls back to oracle floor.
  if (!jaineQuote && !khalaniQuote) {
    return {
      route: 'jaine',
      amountOut: 0n,
      jaineQuote: null,
      diffBps: 0,
      rationale: 'both quotes failed',
    };
  }

  // Outcome 2: only Khalani succeeded.
  if (!jaineQuote && khalaniQuote) {
    return {
      route: 'khalani',
      amountOut: khalaniQuote,
      quoteId: khalaniQuoteId,
      routeId: khalaniRoute?.routeId,
      khalaniRoute,
      jaineQuote: null,
      khalaniQuote,
      diffBps: 0,
      rationale: 'jaine failed',
    };
  }

  // Outcome 3: only Jaine succeeded.
  if (jaineQuote && !khalaniQuote) {
    return {
      route: 'jaine',
      amountOut: jaineQuote,
      jaineQuote,
      diffBps: 0,
      rationale: 'khalani failed',
    };
  }

  // Outcome 4: both succeeded — apply the preference threshold.
  // Khalani wins iff khalani >= jaine * (1 + preferenceBps/10000).
  const diffBps = diffBpsFor(jaineQuote, khalaniQuote);
  const khalaniWins = khalaniQuote * 10000n >= jaineQuote * BigInt(10000 + preferenceBps);

  if (khalaniWins) {
    return {
      route: 'khalani',
      amountOut: khalaniQuote,
      quoteId: khalaniQuoteId,
      routeId: khalaniRoute?.routeId,
      khalaniRoute,
      jaineQuote,
      khalaniQuote,
      diffBps,
      rationale: `khalani beats jaine by ${diffBps} bps (>= ${preferenceBps} bps threshold)`,
    };
  }

  return {
    route: 'jaine',
    amountOut: jaineQuote,
    jaineQuote,
    khalaniQuote,
    diffBps,
    rationale: diffBps >= 0
      ? `jaine wins: khalani edge ${diffBps} bps below ${preferenceBps} bps threshold`
      : `jaine wins: khalani ${-diffBps} bps worse`,
  };
}
