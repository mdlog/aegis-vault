// Network + deployment configuration for Aegis Vault SDK.
//
// Address source-of-truth is `deployments-mainnet.json` (bundled). The V4
// contract stack (manifest-bound factory + refreshed operator marketplace)
// went live on 0G Aristotle Mainnet (chain 16661) on 2026-05-14 and is the
// default surfaced here. The V3 factory + implementation remain exposed as
// `vaultFactoryV3` / `vaultImplementationV3` for read-only legacy access
// (e.g. withdrawing residual balances from pre-cutover vaults). Retired
// operator-marketplace addresses live under `*_retired` keys in the JSON.

import mainnetDeployments from './deployments-mainnet.json' with { type: 'json' };

export const CHAINS = {
  OG_MAINNET: 16661,
  OG_TESTNET: 16602,
  ARBITRUM: 42161,
  HARDHAT: 31337,
};

export const DEFAULT_RPC = {
  [CHAINS.OG_MAINNET]: 'https://evmrpc.0g.ai',
  [CHAINS.OG_TESTNET]: 'https://evmrpc-testnet.0g.ai',
  [CHAINS.ARBITRUM]: 'https://arb1.arbitrum.io/rpc',
  [CHAINS.HARDHAT]: 'http://127.0.0.1:8545',
};

export const EXPLORERS = {
  [CHAINS.OG_MAINNET]: 'https://chainscan.0g.ai',
  [CHAINS.OG_TESTNET]: 'https://chainscan-galileo.0g.ai',
  [CHAINS.ARBITRUM]: 'https://arbiscan.io',
};

/**
 * Canonical Multicall3 address (same on every chain where it's deployed).
 * Verified on 0G Mainnet — callers on other chains should verify before use.
 */
export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

export const MULTICALL3_CHAINS = new Set([
  CHAINS.OG_MAINNET,
  CHAINS.ARBITRUM,
]);

/**
 * Wallet `wallet_addEthereumChain` params for browser wallets. Per chain.
 * Values match what MetaMask / Rabby / Coinbase Wallet expect.
 */
export const NETWORK_PARAMS = {
  [CHAINS.OG_MAINNET]: {
    chainId: '0x4115', // 16661
    chainName: '0G Aristotle Mainnet',
    nativeCurrency: { name: '0G', symbol: '0G', decimals: 18 },
    rpcUrls: ['https://evmrpc.0g.ai'],
    blockExplorerUrls: ['https://chainscan.0g.ai'],
  },
  [CHAINS.OG_TESTNET]: {
    chainId: '0x40da', // 16602
    chainName: '0G Galileo Testnet',
    nativeCurrency: { name: '0G', symbol: '0G', decimals: 18 },
    rpcUrls: ['https://evmrpc-testnet.0g.ai'],
    blockExplorerUrls: ['https://chainscan-galileo.0g.ai'],
  },
  [CHAINS.ARBITRUM]: {
    chainId: '0xa4b1', // 42161
    chainName: 'Arbitrum One',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://arb1.arbitrum.io/rpc'],
    blockExplorerUrls: ['https://arbiscan.io'],
  },
};

/**
 * Canonical address book per chain.
 *
 * For 0G Mainnet the V4 addresses are the authoritative ones — manifest-bound
 * vault factory + implementation, execution registry, the multi-hop Jaine
 * adapter, the Khalani cross-chain adapter, plus the operator marketplace
 * (registry / staking / reputation / insurance) redeployed 2026-05-14.
 *
 * V3 factory + implementation remain exposed as `vaultFactoryV3` /
 * `vaultImplementationV3` for read-only access to pre-cutover vaults.
 */
export const ADDRESSES = {
  [CHAINS.OG_MAINNET]: {
    // V4 stack — live (cutover 2026-05-14)
    vaultFactory: mainnetDeployments.aegisVaultFactoryV4,
    vaultImplementation: mainnetDeployments.aegisVaultImplementationV4,
    executionRegistry: mainnetDeployments.executionRegistryV3,

    // V3 stack — retained for legacy reads (e.g. withdraw from old vaults).
    vaultFactoryV3: mainnetDeployments.aegisVaultFactoryV3,
    vaultImplementationV3: mainnetDeployments.aegisVaultImplementationV3,

    // Operator stack — redeployed fresh on 2026-05-14 (V4 cutover baseline)
    operatorRegistry: mainnetDeployments.operatorRegistry,
    operatorStaking: mainnetDeployments.operatorStaking,
    insurancePool: mainnetDeployments.insurancePool,
    operatorReputation: mainnetDeployments.operatorReputation,

    // Governance + treasury
    governor: mainnetDeployments.aegisGovernor,
    protocolTreasury: mainnetDeployments.protocolTreasury,
    navCalculator: mainnetDeployments.vaultNAVCalculator,

    // Venue adapters — pass one of these as the `venue` on new vaults.
    // `jaineVenueAdapter` is the multi-hop adapter (USDC.e ↔ BTC/ETH via W0G hub).
    // `khalaniVenueAdapter` enables cross-chain routing through Khalani.
    jaineVenueAdapter: mainnetDeployments.jaineVenueAdapterV2,
    khalaniVenueAdapter: mainnetDeployments.khalaniVenueAdapter,

    // V4 supporting libraries (linked into the V4 vault implementation).
    libraries: {
      exec: mainnetDeployments.execLibraryV4,
      io: mainnetDeployments.ioLibraryV3,
      crossChain: mainnetDeployments.crossChainLibraryV4,
    },

    // Tokens (canonical 0G mainnet)
    tokens: mainnetDeployments.realTokens,

    // Oracles
    pyth: mainnetDeployments.pyth,
  },
};

export const ASSET_DECIMALS = {
  USDCe: 6,
  USDC: 6,
  WETH: 18,
  WBTC: 8,
  W0G: 18,
};

/**
 * Return the deployed address book for a given chain.
 * Throws if the chain has no deployment (prevents silent undefined reads).
 *
 * @param {number} chainId
 * @returns {typeof ADDRESSES[16661]}
 */
export function getAddresses(chainId) {
  const entry = ADDRESSES[chainId];
  if (!entry) {
    throw new Error(
      `No Aegis deployment known for chain ${chainId}. ` +
      `Supported: ${Object.keys(ADDRESSES).join(', ')}`,
    );
  }
  return entry;
}

/**
 * Resolve an RPC URL: explicit override wins, then the chain default.
 * Throws if neither is available.
 */
export function resolveRpcUrl(chainId, override) {
  if (override) return override;
  const url = DEFAULT_RPC[chainId];
  if (!url) throw new Error(`No default RPC for chain ${chainId}. Pass rpcUrl explicitly.`);
  return url;
}

export function getExplorerAddressUrl(chainId, address) {
  const base = EXPLORERS[chainId];
  return base && address ? `${base}/address/${address}` : null;
}

export function getExplorerTxUrl(chainId, hash) {
  const base = EXPLORERS[chainId];
  return base && hash ? `${base}/tx/${hash}` : null;
}

export { mainnetDeployments as rawDeployments };

/** Returns true if Multicall3 is verified deployed on the given chain. */
export function hasMulticall3(chainId) {
  return MULTICALL3_CHAINS.has(chainId);
}
