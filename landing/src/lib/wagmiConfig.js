import { http, createConfig } from 'wagmi';
import { injected, metaMask } from 'wagmi/connectors';
import { defineChain } from 'viem';

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
export const wagmiConfig = createConfig({
  chains: [ogTestnet, hardhatLocal],
  connectors: [
    injected({ target: 'metaMask' }),
    injected(),
  ],
  transports: {
    [ogTestnet.id]: http(),
    [hardhatLocal.id]: http(),
  },
});
