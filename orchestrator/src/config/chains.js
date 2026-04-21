/**
 * Multi-chain configuration for the Aegis orchestrator.
 *
 * Aegis runs as a hybrid 0G Chain + Arbitrum deployment:
 *   • 0G Aristotle Mainnet (16661) — verification layer. Vaults deployed here
 *     are demo / sealed-intent showcase only (MockDEX venue, mock assets)
 *     because Jaine pools have no liquidity as of 2026-04.
 *   • Arbitrum One (42161) — execution layer. Vaults deployed here route
 *     through Uniswap V3 with real canonical USDC/WETH/WBTC liquidity.
 *
 * The orchestrator's main cycle currently targets ONE chain per process (the
 * chain described by `CHAIN_ID` + `RPC_URL` in the primary `.env`). This file
 * exposes a registry of additional chains so future work can (a) fan out
 * cycles across both chains from a single process, or (b) at minimum pick up
 * the right factory / registry when an operator deploys a second orchestrator.
 *
 * Nothing here is used by default code paths yet — adding the registry is a
 * scaffold step so we don't hard-code Arbitrum addresses ad hoc later.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function tryReadJson(relPath) {
  const full = resolve(__dirname, '../../..', relPath);
  if (!existsSync(full)) return null;
  try { return JSON.parse(readFileSync(full, 'utf8')); } catch { return null; }
}

const ogMainnetFile = tryReadJson('contracts/deployments-mainnet.json') || {};
const arbitrumFile  = tryReadJson('contracts/deployments-arbitrum.json') || {};

function firstNonEmpty(...vs) {
  return vs.find((v) => v !== undefined && v !== null && v !== '') || '';
}

export const CHAIN_REGISTRY = {
  16661: {
    chainId: 16661,
    label: '0G Aristotle Mainnet',
    role: 'verification',           // operator identity, staking, governance, sealed intent anchor
    rpcUrl: firstNonEmpty(process.env.OG_RPC_URL, process.env.RPC_URL, 'https://evmrpc.0g.ai'),
    explorer: 'https://chainscan.0g.ai',
    realVenue: false,               // MockDEX — demo only until Jaine pools seed
    contracts: {
      vaultFactory:      firstNonEmpty(process.env.OG_VAULT_FACTORY,      ogMainnetFile.aegisVaultFactory),
      executionRegistry: firstNonEmpty(process.env.OG_EXECUTION_REGISTRY, ogMainnetFile.executionRegistry),
      operatorRegistry:  firstNonEmpty(process.env.OG_OPERATOR_REGISTRY,  ogMainnetFile.operatorRegistry),
      operatorStaking:   firstNonEmpty(process.env.OG_OPERATOR_STAKING,   ogMainnetFile.operatorStaking),
      operatorReputation:firstNonEmpty(process.env.OG_OPERATOR_REPUTATION,ogMainnetFile.operatorReputation),
      aegisGovernor:     firstNonEmpty(process.env.OG_AEGIS_GOVERNOR,     ogMainnetFile.aegisGovernor),
      protocolTreasury:  firstNonEmpty(process.env.OG_PROTOCOL_TREASURY,  ogMainnetFile.protocolTreasury),
      insurancePool:     firstNonEmpty(process.env.OG_INSURANCE_POOL,     ogMainnetFile.insurancePool),
      venue:             firstNonEmpty(process.env.OG_VENUE_ADDRESS,      ogMainnetFile.mockDEX),
    },
    assets: {
      USDC: firstNonEmpty(process.env.OG_USDC_ADDRESS, ogMainnetFile.realTokens?.oUSDT, ogMainnetFile.mockUSDC),
      WBTC: firstNonEmpty(process.env.OG_WBTC_ADDRESS, ogMainnetFile.mockWBTC),
      WETH: firstNonEmpty(process.env.OG_WETH_ADDRESS, ogMainnetFile.mockWETH),
    },
  },
  42161: {
    chainId: 42161,
    label: 'Arbitrum One',
    role: 'execution',              // vault custody + Uniswap V3 swaps with real liquidity
    rpcUrl: firstNonEmpty(process.env.ARBITRUM_RPC_URL, 'https://arb1.arbitrum.io/rpc'),
    explorer: 'https://arbiscan.io',
    realVenue: true,
    contracts: {
      vaultFactory:       firstNonEmpty(process.env.ARB_VAULT_FACTORY,      arbitrumFile.aegisVaultFactory),
      executionRegistry:  firstNonEmpty(process.env.ARB_EXECUTION_REGISTRY, arbitrumFile.executionRegistry),
      venue:              firstNonEmpty(process.env.ARB_VENUE_ADDRESS,      arbitrumFile.uniswapV3VenueAdapter),
      navCalculator:      firstNonEmpty(process.env.ARB_NAV_CALCULATOR,     arbitrumFile.vaultNAVCalculator),
      // Verification-layer contracts intentionally NOT on Arbitrum — operators,
      // staking, reputation, governance stay anchored on 0G mainnet. Treasury
      // is logically linked via treasuryLink in deployments-arbitrum.json.
      treasuryLink:       firstNonEmpty(process.env.ARB_TREASURY_LINK,      arbitrumFile.treasuryLink),
    },
    assets: {
      USDC: firstNonEmpty(process.env.ARB_USDC_ADDRESS, arbitrumFile.canonical?.USDC),
      WBTC: firstNonEmpty(process.env.ARB_WBTC_ADDRESS, arbitrumFile.canonical?.WBTC),
      WETH: firstNonEmpty(process.env.ARB_WETH_ADDRESS, arbitrumFile.canonical?.WETH),
    },
    uniV3: {
      router:  firstNonEmpty(process.env.ARB_UNIV3_ROUTER,  arbitrumFile.canonical?.UniV3_Router),
      factory: firstNonEmpty(process.env.ARB_UNIV3_FACTORY, arbitrumFile.canonical?.UniV3_Factory),
    },
    pyth: firstNonEmpty(process.env.ARB_PYTH_ADDRESS, arbitrumFile.canonical?.Pyth),
  },
};

export function getChainConfig(chainId) {
  return CHAIN_REGISTRY[Number(chainId)] || null;
}

/**
 * Pick the chain config to use for a vault at `vaultAddress`. Today this is
 * determined externally (caller passes chainId). Kept as a thin wrapper so
 * future multi-chain routing (event-log probe per chain) lands cleanly.
 */
export function resolveVaultChain(chainId /*, vaultAddress */) {
  return getChainConfig(chainId);
}

/**
 * Shallow readiness check — returns the list of missing contract addresses
 * for a given chain. Used by the deploy-ready checker to avoid running
 * orchestrator loops against an incomplete registry.
 */
export function missingChainContracts(chainId) {
  const cfg = getChainConfig(chainId);
  if (!cfg) return [`chain ${chainId} not in registry`];
  const required = ['vaultFactory', 'executionRegistry', 'venue'];
  if (cfg.role === 'verification') {
    required.push('operatorRegistry', 'operatorStaking', 'operatorReputation');
  }
  return required.filter((k) => !cfg.contracts[k]);
}

export default { CHAIN_REGISTRY, getChainConfig, resolveVaultChain, missingChainContracts };
