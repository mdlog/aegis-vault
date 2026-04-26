import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchSupportedChains,
  fetchSupportedTokens,
  _resetCachesForTest,
} from '../src/services/khalani.js';

// These tests hit the live Khalani / HyperStream API
// (https://api.hyperstream.dev). The endpoints are public and rate limits are
// generous, but we keep the assertions tight on shape rather than exact values
// so the suite stays stable as the supported-asset list grows.

const ZG_CHAIN_ID = 16661;

test('fetchSupportedChains returns a list that includes 0G Mainnet (16661)', async () => {
  _resetCachesForTest();
  const chains = await fetchSupportedChains();
  assert.ok(Array.isArray(chains), 'chains must be an array');
  assert.ok(chains.length > 0, 'chain list must not be empty');
  const zg = chains.find((c) => c && c.id === ZG_CHAIN_ID);
  assert.ok(zg, `0G Mainnet (${ZG_CHAIN_ID}) must be in the supported chains list`);
});

test('fetchSupportedChains caches successive calls (no extra HTTP after first hit)', async () => {
  _resetCachesForTest();
  const first = await fetchSupportedChains();
  const second = await fetchSupportedChains();
  // Same reference proves we served from in-memory cache rather than re-fetching.
  assert.equal(first, second, 'cache must return the identical array reference within TTL');
});

test('fetchSupportedTokens(16661) includes USDC.e and WETH by symbol', async () => {
  const tokens = await fetchSupportedTokens(ZG_CHAIN_ID);
  assert.ok(Array.isArray(tokens), 'tokens must be an array');
  assert.ok(tokens.length > 0, 'token list for 0G must not be empty');
  // Defensive: every entry must be on the requested chain.
  for (const t of tokens) {
    assert.equal(t.chainId, ZG_CHAIN_ID, `token ${t.symbol} has wrong chainId`);
  }
  // Match symbols case-insensitively and accept both `USDC.e` / `USDCe` and
  // `WETH` / `wETH` since the live API exposes the unpunctuated, mixed-case
  // forms (see deviation note in services/khalani.js).
  const symbols = tokens.map((t) => String(t.symbol || '').toLowerCase());
  const hasUsdcE = symbols.some((s) => s === 'usdc.e' || s === 'usdce');
  const hasWeth = symbols.some((s) => s === 'weth' || s === 'wweth' || s === 'w-eth');
  assert.ok(hasUsdcE, `expected USDC.e (or USDCe) in 0G tokens, got: ${symbols.join(', ')}`);
  assert.ok(hasWeth, `expected WETH (or wETH) in 0G tokens, got: ${symbols.join(', ')}`);
});

test('fetchSupportedTokens rejects non-integer chainId', async () => {
  await assert.rejects(
    () => fetchSupportedTokens('16661'),
    /chainId must be an integer/,
  );
});
