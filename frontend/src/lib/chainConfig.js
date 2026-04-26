/**
 * Per-chain asset list, venue resolver, and UX labels for Aegis Vault.
 *
 * Centralized so that CreateVaultPage / VaultDetailPage / OperatorProfilePage
 * never hardcode which tokens or which venue belongs to which chain.
 *
 * Chains handled:
 *   16661  0G Aristotle Mainnet — intelligence + execution. Real Jaine pools
 *          (USDC.e/W0G ~$360K TVL, WETH/W0G ~$278K TVL, WBTC/W0G ~$189K TVL)
 *          route via JaineVenueAdapter. The operator-identity + staking +
 *          governance stack is on the same chain.
 *
 *   42161  Arbitrum One — additional execution layer. Canonical USDC/WETH/WBTC
 *          with deep Uniswap V3 liquidity. Operators can offer vaults on either
 *          chain; users pick the venue that matches their risk appetite.
 *
 *   16602  0G Galileo Testnet — dev-only, MockDEX everywhere.
 *   31337  Hardhat — local, MockDEX everywhere.
 */

import { getDeployments } from './contracts.js';

// ── Chain profiles ──

export const CHAIN_PROFILES = {
  42161: {
    chainId: 42161,
    label: 'Arbitrum One',
    mode: 'production',
    modeLabel: 'Real liquidity',
    modeBadgeClass: 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30',
    description:
      'Real canonical tokens (USDC/WETH/WBTC) routed via Uniswap V3 with deep on-chain liquidity. Use this for vaults holding actual funds.',
    venueKey: 'uniswapV3VenueAdapter',
    venueName: 'Uniswap V3',
    // Canonical token addresses come from the deployments map for chain 42161
    allowedAssets: [
      { symbol: 'USDC', depKey: 'USDC', decimals: 6, isStable: true, canBaseAsset: true },
      { symbol: 'WETH', depKey: 'WETH', decimals: 18, isStable: false, canBaseAsset: false },
      { symbol: 'WBTC', depKey: 'WBTC', decimals: 8, isStable: false, canBaseAsset: false },
    ],
    defaultBaseAsset: 'USDC',
  },
  16661: {
    chainId: 16661,
    label: '0G Aristotle Mainnet',
    mode: 'production',
    modeLabel: 'Real liquidity (Jaine)',
    modeBadgeClass: 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30',
    description:
      'Real canonical tokens routed through Jaine — the Uniswap V3 fork native to 0G. Jaine has live pools for USDC.e/W0G (~$360K TVL), WETH/W0G (~$278K TVL), WBTC/W0G (~$189K TVL) plus cbBTC + st0G pairs. Vaults custody real capital here; operator identity, staking, and governance anchor on the same chain.',
    venueKey: 'jaineVenueAdapter',
    venueName: 'Jaine (Uniswap V3 fork on 0G)',
    // depKey points at the deployments.generated.json field names; sync-frontend.js
    // emits USDCe / WETH / WBTC for chain 16661 pointing at the real Jaine tokens.
    allowedAssets: [
      { symbol: 'USDC.e', depKey: 'USDCe', decimals: 6,  isStable: true,  canBaseAsset: true  },
      { symbol: 'WETH',   depKey: 'WETH',  decimals: 18, isStable: false, canBaseAsset: false },
      { symbol: 'WBTC',   depKey: 'WBTC',  decimals: 8,  isStable: false, canBaseAsset: false },
      { symbol: 'cbBTC',  depKey: 'cbBTC', decimals: 8,  isStable: false, canBaseAsset: false },
    ],
    defaultBaseAsset: 'USDC.e',
  },
  16602: {
    chainId: 16602,
    label: '0G Galileo Testnet',
    mode: 'testnet',
    modeLabel: 'Testnet / mock venue',
    modeBadgeClass: 'bg-steel/20 text-steel/70 ring-1 ring-steel/30',
    description: 'Dev testnet with MockDEX and mock tokens. Free faucet available.',
    venueKey: 'mockDEX',
    venueName: 'MockDEX (testnet)',
    allowedAssets: [
      { symbol: 'USDC', depKey: 'mockUSDC', decimals: 6, isStable: true, canBaseAsset: true },
      { symbol: 'WETH', depKey: 'mockWETH', decimals: 18, isStable: false, canBaseAsset: false },
      { symbol: 'WBTC', depKey: 'mockWBTC', decimals: 8, isStable: false, canBaseAsset: false },
    ],
    defaultBaseAsset: 'USDC',
  },
  31337: {
    chainId: 31337,
    label: 'Hardhat Local',
    mode: 'local',
    modeLabel: 'Local dev',
    modeBadgeClass: 'bg-steel/20 text-steel/60 ring-1 ring-steel/30',
    description: 'Local hardhat node — no real anything.',
    venueKey: 'mockDEX',
    venueName: 'MockDEX (local)',
    allowedAssets: [
      { symbol: 'USDC', depKey: 'mockUSDC', decimals: 6, isStable: true, canBaseAsset: true },
      { symbol: 'WETH', depKey: 'mockWETH', decimals: 18, isStable: false, canBaseAsset: false },
      { symbol: 'WBTC', depKey: 'mockWBTC', decimals: 8, isStable: false, canBaseAsset: false },
    ],
    defaultBaseAsset: 'USDC',
  },
};

export function getChainProfile(chainId) {
  return CHAIN_PROFILES[chainId] || null;
}

/**
 * Resolves venue address for the given chain. Returns `null` when the chain
 * profile or deployment entry is missing — callers should refuse to deploy
 * instead of falling back to a wrong venue.
 *
 * On 0G mainnet (16661), prefer `jaineVenueAdapterV2` (multi-hop, can route
 * USDC.e ↔ BTC/ETH via the W0G hub) when it has been deployed. Falls back to
 * the original single-hop adapter so this works in environments where V2
 * hasn't shipped yet.
 */
export function resolveVenueAddress(chainId) {
  const profile = getChainProfile(chainId);
  if (!profile) return null;
  const deployments = getDeployments(chainId);
  if (chainId === 16661 && deployments?.jaineVenueAdapterV2) {
    return deployments.jaineVenueAdapterV2;
  }
  return deployments?.[profile.venueKey] || null;
}

/**
 * Given a list of asset symbols the user selected (['USDC', 'WETH']), return
 * the on-chain addresses for the active chain. Unknown symbols are dropped.
 */
export function resolveAssetAddresses(chainId, symbols) {
  const profile = getChainProfile(chainId);
  if (!profile) return [];
  const deployments = getDeployments(chainId);
  return symbols
    .map((sym) => {
      const meta = profile.allowedAssets.find((a) => a.symbol === sym);
      if (!meta) return null;
      return deployments?.[meta.depKey] || null;
    })
    .filter(Boolean);
}

export function resolveBaseAsset(chainId, symbol) {
  const profile = getChainProfile(chainId);
  if (!profile) return null;
  const meta = profile.allowedAssets.find((a) => a.symbol === symbol);
  if (!meta || !meta.canBaseAsset) return null;
  const deployments = getDeployments(chainId);
  return {
    address: deployments?.[meta.depKey] || null,
    decimals: meta.decimals,
    symbol: meta.symbol,
    depKey: meta.depKey,
  };
}

/**
 * Is the chain "production-ready" for vaults holding real capital?
 * Only Arbitrum qualifies today.
 */
export function isProductionChain(chainId) {
  return getChainProfile(chainId)?.mode === 'production';
}

export function requiresDemoDisclaimer(chainId) {
  const profile = getChainProfile(chainId);
  if (!profile) return true;
  return profile.mode !== 'production';
}
