import { http, createConfig } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { defineChain } from 'viem';

// ── 0G Aristotle Mainnet ──
export const ogMainnet = defineChain({
  id: 16661,
  name: '0G Aristotle',
  nativeCurrency: { name: '0G', symbol: '0G', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://evmrpc.0g.ai'] },
  },
  blockExplorers: {
    default: { name: '0G Explorer', url: 'https://chainscan.0g.ai' },
  },
  testnet: false,
});

// ── Arbitrum One — execution layer for cross-chain hybrid ──
// Aegis Vault custody + execution lives on Arbitrum (mature DeFi liquidity).
// Operator identity, staking, reputation, governance live on 0G mainnet
// (satisfies hackathon "verifiable on-chain activity on 0G" requirement).
export const arbitrumOne = defineChain({
  id: 42161,
  name: 'Arbitrum One',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://arb1.arbitrum.io/rpc'] },
  },
  blockExplorers: {
    default: { name: 'Arbiscan', url: 'https://arbiscan.io' },
  },
  testnet: false,
});

// ── 0G Galileo Testnet ──
export const ogTestnet = defineChain({
  id: 16602,
  name: '0G Galileo Testnet',
  nativeCurrency: { name: '0G', symbol: '0G', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://evmrpc-testnet.0g.ai'] },
  },
  blockExplorers: {
    default: { name: '0G Explorer', url: 'https://chainscan-galileo.0g.ai' },
  },
  testnet: true,
});

// ── Hardhat Local Chain (for dev) ──
export const hardhatLocal = defineChain({
  id: 31337,
  name: 'Hardhat Local',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://127.0.0.1:8545'] },
  },
  testnet: true,
});

// ── Wagmi Config ──
//
// Production toggle: set VITE_DISABLE_TESTNETS=1 in production builds to hide
// testnet + local chains from the wallet selector. This prevents users from
// accidentally connecting MetaMask to the wrong network on a mainnet release.
const isProd = import.meta.env.VITE_DISABLE_TESTNETS === '1';
const enabledChains = isProd
  ? [ogMainnet, arbitrumOne]
  : [ogMainnet, arbitrumOne, ogTestnet, hardhatLocal];

export const wagmiConfig = createConfig({
  chains: enabledChains,
  connectors: [
    injected({ target: 'metaMask' }),
    injected(),
  ],
  transports: {
    [ogMainnet.id]: http(),
    [arbitrumOne.id]: http(),
    [ogTestnet.id]: http(),
    [hardhatLocal.id]: http(),
  },
});
