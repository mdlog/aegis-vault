import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

function readDeploymentsFile() {
  const candidatePath = process.env.DEPLOYMENTS_FILE
    ? resolve(__dirname, '../../', process.env.DEPLOYMENTS_FILE)
    : resolve(__dirname, '../../../contracts/deployments.json');

  if (!existsSync(candidatePath)) {
    return { path: candidatePath, data: null };
  }

  try {
    return {
      path: candidatePath,
      data: JSON.parse(readFileSync(candidatePath, 'utf8')),
    };
  } catch {
    return { path: candidatePath, data: null };
  }
}

function firstNonEmpty(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') || '';
}

const deploymentFile = readDeploymentsFile();
const deploymentDefaults = deploymentFile.data || {};
const derivedChainId = parseInt(
  process.env.CHAIN_ID ||
    deploymentDefaults.chainId ||
    (deploymentDefaults.network === 'og_mainnet' ? '16661'
      : deploymentDefaults.network === 'og_testnet' ? '16602'
      : '31337')
);
const derivedRpcUrl = firstNonEmpty(
  process.env.RPC_URL,
  derivedChainId === 16661 ? 'https://evmrpc.0g.ai'
    : derivedChainId === 16602 ? 'https://evmrpc-testnet.0g.ai'
    : 'http://127.0.0.1:8545'
);

const config = {
  // Network
  rpcUrl: derivedRpcUrl,
  chainId: derivedChainId,
  privateKey: process.env.PRIVATE_KEY || '',
  deploymentsFile: deploymentFile.path,

  // Contract addresses
  contracts: {
    vaultFactory: firstNonEmpty(process.env.VAULT_FACTORY_ADDRESS, deploymentDefaults.aegisVaultFactory),
    executionRegistry: firstNonEmpty(process.env.EXECUTION_REGISTRY_ADDRESS, deploymentDefaults.executionRegistry),
    vault: firstNonEmpty(process.env.VAULT_ADDRESS, deploymentDefaults.demoVault),
    usdc: firstNonEmpty(process.env.USDC_ADDRESS, deploymentDefaults.mockUSDC, deploymentDefaults.realTokens?.oUSDT, deploymentDefaults.canonical?.USDC),
    wbtc: firstNonEmpty(process.env.WBTC_ADDRESS, deploymentDefaults.mockWBTC, deploymentDefaults.canonical?.WBTC),
    weth: firstNonEmpty(process.env.WETH_ADDRESS, deploymentDefaults.mockWETH, deploymentDefaults.canonical?.WETH),
    // Phase 1-5 production stack
    protocolTreasury: firstNonEmpty(process.env.PROTOCOL_TREASURY_ADDRESS, deploymentDefaults.protocolTreasury),
    operatorRegistry: firstNonEmpty(process.env.OPERATOR_REGISTRY_ADDRESS, deploymentDefaults.operatorRegistry),
    operatorStaking: firstNonEmpty(process.env.OPERATOR_STAKING_ADDRESS, deploymentDefaults.operatorStaking),
    insurancePool: firstNonEmpty(process.env.INSURANCE_POOL_ADDRESS, deploymentDefaults.insurancePool),
    operatorReputation: firstNonEmpty(process.env.OPERATOR_REPUTATION_ADDRESS, deploymentDefaults.operatorReputation),
    aegisGovernor: firstNonEmpty(process.env.AEGIS_GOVERNOR_ADDRESS, deploymentDefaults.aegisGovernor),
  },

  // 0G Compute (uses mainnet for inference — more models, better availability)
  ogCompute: {
    rpcUrl: process.env.OG_COMPUTE_RPC || 'https://evmrpc.0g.ai',
    privateKey: process.env.OG_COMPUTE_PRIVATE_KEY || process.env.PRIVATE_KEY || '',
    preferredModel: process.env.OG_COMPUTE_MODEL || '', // empty = auto-discover
  },

  // ── Track 2: Sealed Strategy Mode (TEE attestation signer) ──
  // The TEE signer is the ECDSA key bound to the TEE-attested 0G Compute pipeline.
  // For sealed-mode vaults, the orchestrator signs the intent hash with this key
  // and the vault verifies the signature against policy.attestedSigner on-chain.
  // SECURITY: this key must be different from the orchestrator's hot wallet, and
  // must only ever be used to sign valid TEE-attested inference outputs.
  teeSigner: {
    privateKey: process.env.TEE_SIGNER_PRIVATE_KEY || '',
  },

  // 0G Storage
  ogStorage: {
    rpc: process.env.OG_STORAGE_RPC || 'https://storage-testnet.0g.ai',
    kvAddress: process.env.OG_STORAGE_KV_ADDRESS || '',
  },

  // Market data
  coingeckoUrl: process.env.COINGECKO_API_URL || 'https://api.coingecko.com/api/v3',

  // Swap execution — minAmountOut is built from the on-chain venue quote
  // (`getAmountOut`) multiplied by (1 - slippage). Oracle price is used only as a
  // sanity floor. On mainnet set this tight (50 bps = 0.5%); on testnet with a
  // MockDEX whose rates drift from oracle, 300–500 bps is usually needed.
  swapSlippageBps: parseInt(process.env.SWAP_SLIPPAGE_BPS || '300'),

  // Orchestrator
  cycleIntervalMinutes: parseInt(process.env.CYCLE_INTERVAL_MINUTES || '5'),
  port: parseInt(process.env.PORT || '4002'),
  logLevel: process.env.LOG_LEVEL || 'info',
  apiKey: process.env.ORCHESTRATOR_API_KEY || '',

  // ── Fail-safe mode (production) ──
  // When STRICT_MODE=1, the orchestrator refuses to operate on stale or fallback data:
  //   - CoinGecko / Pyth fetch failures throw instead of returning hardcoded prices
  //   - 0G Compute failures abort the cycle instead of falling back to local heuristics
  //   - Missing operator/staking contracts cause the cycle to skip the vault, not run unrestricted
  //
  // Recommended for any deployment custodying real funds. Default off to keep
  // dev/testnet ergonomics smooth.
  strictMode: process.env.STRICT_MODE === '1',

  // CORS allowlist (comma-separated origins). Empty = allow all (dev only).
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  // File log path (optional). When set, logger writes structured JSON to this file
  // in addition to console output.
  logFile: process.env.LOG_FILE || '',

  // Local state directory. In staging / production, point this at a persistent
  // volume. Defaults to orchestrator/data for local development.
  dataDir: process.env.DATA_DIR || '',

  // Asset mapping (symbol → coingecko id & contract address)
  assets: {
    BTC: { coingeckoId: 'bitcoin', symbol: 'BTC', decimals: 8 },
    ETH: { coingeckoId: 'ethereum', symbol: 'ETH', decimals: 18 },
    USDC: { coingeckoId: 'usd-coin', symbol: 'USDC', decimals: 6 },
  },
};

export function validateConfig(targetConfig = config) {
  const errors = [];

  if (!targetConfig.contracts.vaultFactory) {
    errors.push('VAULT_FACTORY_ADDRESS missing');
  }
  if (!targetConfig.contracts.executionRegistry) {
    errors.push('EXECUTION_REGISTRY_ADDRESS missing');
  }

  if (targetConfig.strictMode) {
    if (!targetConfig.privateKey) {
      errors.push('PRIVATE_KEY missing in STRICT_MODE');
    }
    if (!targetConfig.apiKey) {
      errors.push('ORCHESTRATOR_API_KEY missing in STRICT_MODE');
    }
    if (!targetConfig.corsAllowedOrigins.length) {
      errors.push('CORS_ALLOWED_ORIGINS missing in STRICT_MODE');
    }

    const strictContracts = [
      ['protocolTreasury', 'PROTOCOL_TREASURY_ADDRESS'],
      ['operatorRegistry', 'OPERATOR_REGISTRY_ADDRESS'],
      ['operatorStaking', 'OPERATOR_STAKING_ADDRESS'],
      ['insurancePool', 'INSURANCE_POOL_ADDRESS'],
      ['operatorReputation', 'OPERATOR_REPUTATION_ADDRESS'],
      ['aegisGovernor', 'AEGIS_GOVERNOR_ADDRESS'],
    ];

    for (const [key, label] of strictContracts) {
      if (!targetConfig.contracts[key]) {
        errors.push(`${label} missing in STRICT_MODE`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export default config;
