import AegisVaultABI from './abi/AegisVault.json';
import AegisVaultFactoryABI from './abi/AegisVaultFactory.json';
import ExecutionRegistryABI from './abi/ExecutionRegistry.json';
import MockERC20ABI from './abi/MockERC20.json';

export { AegisVaultABI, AegisVaultFactoryABI, ExecutionRegistryABI, MockERC20ABI };

// ── Deployment Addresses ──
// Updated after each deploy. In production, load from deployments.json or env.

const DEPLOYMENTS = {
  // Hardhat local (default — updated by deploy script)
  31337: {
    executionRegistry: '0xD0141E899a65C95a556fE2B27e5982A6DE7fDD7A',
    aegisVaultFactory: '0x07882Ae1ecB7429a84f1D53048d35c4bB2056877',
    mockUSDC: '0xA7c59f010700930003b33aB25a7a0679C860f29c',
    mockWBTC: '0xfaAddC93baf78e89DCf37bA67943E1bE8F37Bb8c',
    mockWETH: '0x276C216D241856199A83bf27b2286659e5b877D3',
    mockDEX: '0x3347B4d90ebe72BeFb30444C9966B2B990aE9FcB',
    demoVault: '0xAA058A2746e2a0Bb04c1dB7669ec5fe16a5CC2c3',
    orchestratorWallet: '0xDB13C2dE3CD57d529CeA16E8EE6ae53a498b878D',
  },
  // 0G Galileo Testnet (fill after deploying to testnet)
  16602: {
    executionRegistry: '0xDF277f39d4869B1a4bb7Fa2D25e58ab32E2af998',
    aegisVaultFactory: '0x2A0CAA1d639060446fA1bA799b6B64810B5B4aff',
    mockUSDC: '0xcb7F4c52f72DA18d27Bc18C4c3f706b6ba361BC1',
    mockWBTC: '0x0d8C28Ad2741cBec172003eee01e7BD97450b5A9',
    mockWETH: '0x339d0484699C0E1232aE0947310a5694B7e0E03A',
    mockDEX: '0x8eeF4E72ec2ff6f9E00a6D2029bEcB8FcB2f03E6',
    demoVault: '0xFFac2840f762b6003Ce291bd5B19c2890Ea5DAB2',
    orchestratorWallet: '0xDB13C2dE3CD57d529CeA16E8EE6ae53a498b878D',
  },
};

export function getDeployments(chainId) {
  return DEPLOYMENTS[chainId] || DEPLOYMENTS[31337];
}

// ── Orchestrator API ──
export const ORCHESTRATOR_URL = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  ? 'http://localhost:4002'
  : 'http://localhost:4002'; // Update for production

// ── Asset Metadata ──
export const ASSET_META = {
  USDC: { symbol: 'USDC', name: 'USD Coin', decimals: 6, color: '#2775ca' },
  BTC: { symbol: 'BTC', name: 'Bitcoin', decimals: 8, color: '#f7931a' },
  WBTC: { symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8, color: '#f7931a' },
  ETH: { symbol: 'ETH', name: 'Ethereum', decimals: 18, color: '#627eea' },
  WETH: { symbol: 'WETH', name: 'Wrapped ETH', decimals: 18, color: '#627eea' },
  '0G': { symbol: '0G', name: '0G Token', decimals: 18, color: '#4cc9f0' },
};
