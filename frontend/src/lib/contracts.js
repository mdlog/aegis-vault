import AegisVaultABI from './abi/AegisVault.json';
import AegisVaultFactoryABI from './abi/AegisVaultFactory.json';
import ExecutionRegistryABI from './abi/ExecutionRegistry.json';
import OperatorRegistryABI from './abi/OperatorRegistry.json';
import ProtocolTreasuryABI from './abi/ProtocolTreasury.json';
import OperatorStakingABI from './abi/OperatorStaking.json';
import InsurancePoolABI from './abi/InsurancePool.json';
import OperatorReputationABI from './abi/OperatorReputation.json';
import AegisGovernorABI from './abi/AegisGovernor.json';
import MockERC20ABI from './abi/MockERC20.json';
import generatedDeployments from './deployments.generated.json';

export {
  AegisVaultABI,
  AegisVaultFactoryABI,
  ExecutionRegistryABI,
  OperatorRegistryABI,
  ProtocolTreasuryABI,
  OperatorStakingABI,
  InsurancePoolABI,
  OperatorReputationABI,
  AegisGovernorABI,
  MockERC20ABI,
};

// ── Deployment Addresses ──
//
// `STATIC_DEPLOYMENTS` is only a safety net for local development. Real staging /
// production addresses should come from `deployments.generated.json`, which is
// written by `contracts/scripts/sync-frontend.js` after each deploy.

const STATIC_DEPLOYMENTS = {
  // Hardhat local (default — updated by deploy script)
  31337: {
    executionRegistry: '0xD0141E899a65C95a556fE2B27e5982A6DE7fDD7A',
    aegisVaultFactory: '0x07882Ae1ecB7429a84f1D53048d35c4bB2056877',
    operatorRegistry: '',
    protocolTreasury: '',
    operatorStaking: '',
    insurancePool: '',
    operatorReputation: '',
    aegisGovernor: '',
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
    operatorRegistry: '',
    protocolTreasury: '',
    operatorStaking: '',
    insurancePool: '',
    operatorReputation: '',
    aegisGovernor: '',
    mockUSDC: '0xcb7F4c52f72DA18d27Bc18C4c3f706b6ba361BC1',
    mockWBTC: '0x0d8C28Ad2741cBec172003eee01e7BD97450b5A9',
    mockWETH: '0x339d0484699C0E1232aE0947310a5694B7e0E03A',
    mockDEX: '0x8eeF4E72ec2ff6f9E00a6D2029bEcB8FcB2f03E6',
    demoVault: '0xFFac2840f762b6003Ce291bd5B19c2890Ea5DAB2',
    orchestratorWallet: '0xDB13C2dE3CD57d529CeA16E8EE6ae53a498b878D',
  },
  // 0G Aristotle Mainnet — VERIFICATION layer (operator identity, staking,
  // reputation, governance). Submit-required for hackathon. Fill after running
  // deploy-0g-verification.js.
  16661: {
    // Verification layer
    operatorRegistry: '',
    operatorStaking: '',
    insurancePool: '',
    operatorReputation: '',
    aegisGovernor: '',
    protocolTreasury: '',
    // Execution layer NOT here — lives on Arbitrum (chain 42161)
    executionRegistry: '',
    aegisVaultFactory: '',
    // Real on-chain stake token (Hyperlane bridged USDT)
    oUSDT: '0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189',
    W0G:   '0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c',
    // mockUSDC alias points to oUSDT so existing hooks read the right token
    mockUSDC: '0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189',
    mockWBTC: '0x5959097B719cBACD35D11f8d959c145EBbb88f33',
    mockWETH: '0x4f69AC64BBB4D73a098c398af498024A3715ff57',
    mockDEX: '0xE21dbC01424533ABc96237BfAeaE5d625d58e359',
    demoVault: '',
    orchestratorWallet: '',
  },
  // Arbitrum One — EXECUTION layer (vault custody + Uniswap V3 swaps).
  // Real DeFi liquidity. Fill after running deploy-arbitrum-execution.js.
  42161: {
    // Execution layer
    executionRegistry: '',
    aegisVaultFactory: '',
    uniswapV3VenueAdapter: '',
    vaultNAVCalculator: '',
    // Verification layer NOT here — lives on 0G mainnet (chain 16661)
    operatorRegistry: '',
    operatorStaking: '',
    insurancePool: '',
    operatorReputation: '',
    aegisGovernor: '',
    protocolTreasury: '',
    // Real on-chain canonical tokens (verified)
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    WBTC: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    // Aliases for hooks that read mockUSDC etc — point at canonical USDC
    mockUSDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    mockWBTC: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    mockWETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    // Uniswap V3 canonical
    uniV3Router: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    uniV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    pyth: '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C',
    mockDEX: '',
    demoVault: '',
    orchestratorWallet: '',
  },
};

const DEPLOYMENT_SCHEMA = {
  executionRegistry: '',
  aegisVaultFactory: '',
  operatorRegistry: '',
  protocolTreasury: '',
  operatorStaking: '',
  insurancePool: '',
  operatorReputation: '',
  aegisGovernor: '',
  mockUSDC: '',
  mockWBTC: '',
  mockWETH: '',
  mockDEX: '',
  demoVault: '',
  orchestratorWallet: '',
};

function normalizeDeploymentMap(source = {}) {
  return Object.fromEntries(
    Object.entries(source).map(([chainId, entry]) => [
      String(chainId),
      { ...DEPLOYMENT_SCHEMA, ...entry },
    ])
  );
}

const generatedMap = normalizeDeploymentMap(generatedDeployments);
const staticMap = normalizeDeploymentMap(STATIC_DEPLOYMENTS);

const DEPLOYMENTS = {
  ...staticMap,
  ...generatedMap,
};

export const ENABLE_DEMO_FALLBACKS = import.meta.env.VITE_ENABLE_DEMO_FALLBACKS === '1';
export const ORCHESTRATOR_URL =
  import.meta.env.VITE_ORCHESTRATOR_URL ||
  (import.meta.env.DEV ? 'http://localhost:4002' : '');

export function getDeployments(chainId) {
  const key = String(chainId || 31337);
  return DEPLOYMENTS[key] || DEPLOYMENTS['31337'];
}

export function getDefaultVaultAddress(chainId) {
  const deployments = getDeployments(chainId);
  return ENABLE_DEMO_FALLBACKS ? deployments.demoVault || null : null;
}

export function getNetworkLabel(chainId) {
  if (chainId === 16661) return '0G Aristotle Mainnet';
  if (chainId === 42161) return 'Arbitrum One';
  if (chainId === 16602) return '0G Galileo Testnet';
  if (chainId === 31337) return 'Hardhat Local';
  return `Chain ${chainId || '—'}`;
}

export function getExplorerBaseUrl(chainId) {
  if (chainId === 16661) return 'https://chainscan.0g.ai';
  if (chainId === 42161) return 'https://arbiscan.io';
  if (chainId === 16602) return 'https://chainscan-galileo.0g.ai';
  return null;
}

export function isConfiguredAddress(address) {
  return typeof address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function getVaultRoute(vaultAddress) {
  return vaultAddress ? `/app/vault/${vaultAddress}` : '/app';
}

export function getSettingsRoute(vaultAddress) {
  return vaultAddress ? `/app/settings/${vaultAddress}` : '/app/settings';
}

// ── Asset Metadata ──
export const ASSET_META = {
  USDC: { symbol: 'USDC', name: 'USD Coin', decimals: 6, color: '#2775ca' },
  BTC: { symbol: 'BTC', name: 'Bitcoin', decimals: 8, color: '#f7931a' },
  WBTC: { symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8, color: '#f7931a' },
  ETH: { symbol: 'ETH', name: 'Ethereum', decimals: 18, color: '#627eea' },
  WETH: { symbol: 'WETH', name: 'Wrapped ETH', decimals: 18, color: '#627eea' },
  '0G': { symbol: '0G', name: '0G Token', decimals: 18, color: '#4cc9f0' },
};
